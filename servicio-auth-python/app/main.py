"""
Microservicio de AUTENTICACION y USUARIOS — Python + FastAPI + SQLAlchemy + PostgreSQL

Gateway: https://localhost/api/auth/...
  POST   /login               -> token JWT
  GET    /me                  -> datos del usuario del token
  GET    /usuarios            -> lista (profesor o servicio interno), filtro ?rol=
  POST   /usuarios            -> crear usuario (solo profesor), opcionalmente inscrito en secciones
  PATCH  /usuarios/{id}       -> editar / activar / cambiar clave
  DELETE /usuarios/{id}       -> eliminar
"""
import logging
import os
import re
from typing import Optional

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import codigos
from .database import Base, SessionLocal, Usuario, engine, get_db
from .security import (
    INTERNAL_TOKEN,
    crear_token,
    hash_password,
    profesor_o_interno,
    solo_profesor,
    usuario_actual,
    verify_password,
)

log = logging.getLogger("uvicorn.error")
app = FastAPI(title="Servicio Auth (Python)")

CLASES_URL = "http://servicio-clases:8080"
NOTIF_URL = "http://servicio-notificaciones:8080"
PUBLIC_URL = os.getenv("PUBLIC_URL", "https://localhost")


# ----------------------------------------------------------------- arranque
@app.on_event("startup")
def iniciar():
    Base.metadata.create_all(engine)  # crea la tabla usuarios si no existe
    with SessionLocal() as db:
        email = os.getenv("ADMIN_EMAIL", "").strip().lower()
        if email and not db.query(Usuario).filter_by(email=email).first():
            db.add(Usuario(
                nombre=os.getenv("ADMIN_NOMBRE", "Profesor"),
                email=email,
                password_hash=hash_password(os.getenv("ADMIN_PASSWORD", "cambiame")),
                rol="profesor", email_verificado=True, estado="activo",
            ))
            db.commit()
            log.info("Usuario inicial creado: %s", email)


# ----------------------------------------------------------------- esquemas
class LoginIn(BaseModel):
    email: str
    password: str


class UsuarioIn(BaseModel):
    nombre: str = Field(min_length=2)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=6)
    rol: str = Field(default="estudiante", pattern="^(estudiante|profesor)$")
    secciones: list[int] = []  # secciones (servicio de clases) donde se inscribe al estudiante


class RegistroIn(BaseModel):
    """Alguien se registra solo (estudiante o profesor). Nunca puede registrarse como admin."""
    nombre: str = Field(min_length=2, max_length=120)
    cedula: str
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=160)
    password: str = Field(min_length=8, max_length=72)  # bcrypt solo lee los primeros 72 bytes
    rol: str = Field(pattern="^(estudiante|profesor)$")


def normalizar_cedula(texto: str) -> str:
    """'v12345678', 'V-12.345.678' o '12345678' -> 'V-12345678'. Sin letra se asume venezolano (V)."""
    m = re.fullmatch(r"([VvEe])?-?(\d{6,9})", texto.strip().replace(".", "").replace(" ", ""))
    if not m:
        raise HTTPException(422, "La cedula debe tener entre 6 y 9 digitos (ej. V-12345678)")
    return f"{(m.group(1) or 'V').upper()}-{m.group(2)}"


class VerificarIn(BaseModel):
    email: str
    codigo: str = Field(min_length=6, max_length=6)


class UsuarioPatch(BaseModel):
    nombre: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=6)
    activo: Optional[bool] = None


def a_json(u: Usuario) -> dict:
    # password_hash jamas sale del servicio
    return {"id": u.id, "nombre": u.nombre, "email": u.email, "cedula": u.cedula, "rol": u.rol,
            "estado": u.estado, "activo": u.activo, "creado_en": u.creado_en.isoformat() if u.creado_en else None}


# ----------------------------------------------------------------- comunicacion con otros servicios
def avisar_estudiante_nuevo(u: dict, secciones: list[int]):
    """Python -> Java (inscribir en sus secciones; Java -> Node le asigna preguntas) y Python -> Go (bienvenida)."""
    headers = {"X-Internal-Token": INTERNAL_TOKEN}
    if secciones:
        try:
            httpx.post(f"{CLASES_URL}/interno/inscribir", headers=headers, timeout=60,
                       json={"estudianteId": u["id"], "secciones": secciones})
        except httpx.HTTPError as e:
            log.warning("No se pudo inscribir en servicio-clases: %s", e)
    try:
        httpx.post(f"{NOTIF_URL}/interno/notificar", headers=headers, timeout=10, json={
            "usuarioId": u["id"], "email": u["email"], "nombre": u["nombre"],
            "titulo": "Bienvenido al Aula Virtual LPR",
            "mensaje": f"Tu profesor creo tu cuenta con el correo {u['email']}. "
                       "Entra con la clave que ella te entrego.",
            "enlace": PUBLIC_URL, "enviarCorreo": True,
        })
    except httpx.HTTPError as e:
        log.warning("No se pudo avisar a servicio-notificaciones: %s", e)


def avisar_nuevo_profesor(profesor: dict, admins: list[dict]):
    """Python -> Go: avisa a los admins (campanita + correo) que un profesor espera su aprobacion."""
    for a in admins:
        try:
            httpx.post(f"{NOTIF_URL}/interno/notificar", headers={"X-Internal-Token": INTERNAL_TOKEN}, timeout=10, json={
                "usuarioId": a["id"], "email": a["email"], "nombre": a["nombre"],
                "titulo": "Un profesor espera tu aprobacion",
                "mensaje": f"{profesor['nombre']} ({profesor['email']}, cedula {profesor['cedula']}) confirmo su correo "
                           "y espera que apruebes su cuenta de profesor.",
                "enlace": f"{PUBLIC_URL}/app.html#/admin", "enviarCorreo": True,
            })
        except httpx.HTTPError as e:
            log.warning("No se pudo avisar al admin %s: %s", a["email"], e)


# ----------------------------------------------------------------- endpoints
@app.get("/health")
def health():
    return {"servicio": "auth", "lenguaje": "Python / FastAPI", "orm": "SQLAlchemy",
            "bd": "PostgreSQL", "estado": "ok"}


@app.post("/registro", status_code=201)
def registro(datos: RegistroIn, db: Session = Depends(get_db)):
    """Crea la cuenta SIN verificar y envia un codigo al correo. Sin el codigo no se puede entrar."""
    email = datos.email.strip().lower()
    cedula = normalizar_cedula(datos.cedula)

    existente = db.query(Usuario).filter_by(email=email).first()
    if existente and existente.estado != "sin_verificar":
        raise HTTPException(409, "Ya existe una cuenta con ese correo")
    if existente:
        # Registro a medias (nunca confirmo el codigo): solo se reenvia el codigo. NO se pisan sus datos:
        # si no, alguien podria registrar el correo de otra persona con una clave suya y, cuando la
        # victima pusiera el codigo que le llego, la cuenta quedaria verificada con la clave del atacante.
        codigos.emitir(db, existente, "verificar")
        return {"mensaje": "Te reenviamos el codigo a tu correo", "email": email}

    if db.query(Usuario).filter_by(cedula=cedula).first():
        raise HTTPException(409, "Ya existe una cuenta con esa cedula")
    u = Usuario(nombre=datos.nombre.strip(), email=email, cedula=cedula, rol=datos.rol,
                password_hash=hash_password(datos.password), email_verificado=False, estado="sin_verificar")
    db.add(u)
    db.commit()
    db.refresh(u)
    try:
        codigos.emitir(db, u, "verificar")
    except HTTPException:
        # Si el correo no salio (direccion inexistente, SMTP caido) no dejamos una cuenta que nadie
        # podria verificar ocupando el correo y la cedula.
        db.delete(u)
        db.commit()
        raise
    return {"mensaje": "Te enviamos un codigo de 6 digitos a tu correo", "email": email}


@app.post("/registro/verificar")
def registro_verificar(datos: VerificarIn, tareas: BackgroundTasks, db: Session = Depends(get_db)):
    """Confirma el codigo del correo. Estudiante: queda activo y entra. Profesor: queda en lista de espera."""
    u = db.query(Usuario).filter_by(email=datos.email.strip().lower()).first()
    # Mismo mensaje exista o no el correo: no se revela que cuentas existen
    if not u:
        raise HTTPException(400, "El codigo venció o no existe. Pide uno nuevo.")
    if u.estado != "sin_verificar":
        raise HTTPException(409, "Esta cuenta ya esta verificada. Inicia sesion.")

    codigos.validar(db, u, "verificar", datos.codigo)
    u.email_verificado = True
    if u.rol == "estudiante":
        u.estado = "activo"
        db.commit()
        return {"token": crear_token(u), "usuario": a_json(u), "estado": "activo"}

    u.estado = "en_espera"  # profesor: necesita que un admin lo apruebe
    db.commit()
    admins = [a_json(a) for a in db.query(Usuario).filter_by(rol="admin", estado="activo").all()]
    tareas.add_task(avisar_nuevo_profesor, a_json(u), admins)
    return {"estado": "en_espera",
            "mensaje": "Correo confirmado. Un administrador debe aprobar tu cuenta de profesor; te avisaremos por correo."}


@app.post("/login")
def login(datos: LoginIn, db: Session = Depends(get_db)):
    u = db.query(Usuario).filter_by(email=datos.email.strip().lower()).first()
    if not u or not verify_password(datos.password, u.password_hash):
        raise HTTPException(401, "Correo o clave incorrectos")
    if not u.activo:
        raise HTTPException(403, "Tu cuenta esta desactivada")
    return {"token": crear_token(u), "usuario": a_json(u)}


@app.get("/me")
def me(user: dict = Depends(usuario_actual), db: Session = Depends(get_db)):
    u = db.get(Usuario, int(user["sub"]))
    if not u:
        raise HTTPException(404, "Usuario no existe")
    return a_json(u)


@app.get("/usuarios")
def listar(rol: Optional[str] = None, _=Depends(profesor_o_interno), db: Session = Depends(get_db)):
    q = db.query(Usuario)
    if rol:
        q = q.filter_by(rol=rol)
    return [a_json(u) for u in q.order_by(Usuario.rol.desc(), Usuario.nombre).all()]


@app.post("/usuarios", status_code=201)
def crear(datos: UsuarioIn, tareas: BackgroundTasks, _=Depends(solo_profesor),
          db: Session = Depends(get_db)):
    email = datos.email.strip().lower()
    if db.query(Usuario).filter_by(email=email).first():
        raise HTTPException(409, "Ya existe un usuario con ese correo")
    u = Usuario(nombre=datos.nombre.strip(), email=email, password_hash=hash_password(datos.password),
                rol=datos.rol, email_verificado=True, estado="activo")
    db.add(u)
    db.commit()
    db.refresh(u)
    if u.rol == "estudiante":
        tareas.add_task(avisar_estudiante_nuevo, a_json(u), datos.secciones)
    return a_json(u)


@app.patch("/usuarios/{uid}")
def editar(uid: int, datos: UsuarioPatch, user=Depends(solo_profesor), db: Session = Depends(get_db)):
    u = db.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Usuario no existe")
    if datos.nombre is not None:
        u.nombre = datos.nombre.strip()
    if datos.password:
        u.password_hash = hash_password(datos.password)
    if datos.activo is not None:
        if u.id == int(user["sub"]) and not datos.activo:
            raise HTTPException(400, "No puedes desactivar tu propia cuenta")
        u.estado = "activo" if datos.activo else "desactivado"
    db.commit()
    return a_json(u)


@app.delete("/usuarios/{uid}", status_code=204)
def eliminar(uid: int, user=Depends(solo_profesor), db: Session = Depends(get_db)):
    u = db.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Usuario no existe")
    if u.id == int(user["sub"]):
        raise HTTPException(400, "No puedes eliminar tu propia cuenta")
    db.delete(u)
    db.commit()
    # Python -> Java: sacarlo de las secciones donde estaba inscrito
    try:
        httpx.delete(f"{CLASES_URL}/interno/estudiantes/{uid}", headers={"X-Internal-Token": INTERNAL_TOKEN}, timeout=10)
    except httpx.HTTPError as e:
        log.warning("No se pudo actualizar servicio-clases: %s", e)
