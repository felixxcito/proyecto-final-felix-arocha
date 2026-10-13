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
import jwt
from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from . import codigos
from .database import Base, SessionLocal, Usuario, engine, get_db
from .dominio_correo import dominio_recibe_correo
from .security import (
    INTERNAL_TOKEN,
    crear_token,
    hash_password,
    ALGORITHM,
    SECRET_KEY,
    solo_admin,
    solo_interno,
    token_de,
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
                nombre=os.getenv("ADMIN_NOMBRE", "Administrador"),
                email=email,
                password_hash=hash_password(os.getenv("ADMIN_PASSWORD", "cambiame")),
                rol="admin", email_verificado=True, estado="activo",
            ))
            db.commit()
            log.info("Administrador creado: %s", email)


# ----------------------------------------------------------------- esquemas
class LoginIn(BaseModel):
    email: str
    password: str
    recordarme: bool = False  # sesion de 30 dias en vez de 12 horas


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


class ReenviarIn(BaseModel):
    email: str


class RecuperarConfirmarIn(BaseModel):
    email: str
    codigo: str = Field(min_length=6, max_length=6)
    nueva_clave: str = Field(min_length=8, max_length=72, alias="nuevaClave")


class EstadoIn(BaseModel):
    estado: str = Field(pattern="^(activo|desactivado)$")


def a_json(u: Usuario) -> dict:
    # password_hash jamas sale del servicio
    return {"id": u.id, "nombre": u.nombre, "email": u.email, "cedula": u.cedula, "rol": u.rol,
            "estado": u.estado, "activo": u.activo, "creado_en": u.creado_en.isoformat() if u.creado_en else None}


# ----------------------------------------------------------------- comunicacion con otros servicios
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


@app.get("/verificar")
def verificar(authorization: str = Header(default=""), x_original_uri: str = Header(default=""),
              db: Session = Depends(get_db)):
    """Lo consulta el gateway (auth_request de Nginx) ANTES de reenviar cada peticion a cualquier servicio.

    Los servicios validan la firma del token por su cuenta, pero eso no sabe si la cuenta sigue activa. Aqui si
    se mira la base: si el usuario fue desactivado o eliminado, el gateway corta con 401 al instante en los 4
    servicios, sin esperar a que venza el token.
      204 -> pasa (o no hay token / token invalido: eso lo decide el servicio de destino)
      401 -> el token es valido pero la cuenta ya no esta activa
    """
    token = token_de(authorization, x_original_uri)
    if not token:
        return Response(status_code=204)
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return Response(status_code=204)
    u = db.get(Usuario, int(payload["sub"]))
    if not u or u.estado != "activo":
        return Response(status_code=401)
    return Response(status_code=204)


@app.post("/registro", status_code=201)
def registro(datos: RegistroIn, db: Session = Depends(get_db)):
    """Crea la cuenta SIN verificar y envia un codigo al correo. Sin el codigo no se puede entrar."""
    email = datos.email.strip().lower()
    cedula = normalizar_cedula(datos.cedula)
    if not dominio_recibe_correo(email):
        raise HTTPException(422, "Ese dominio de correo no existe o no recibe mensajes. Revisa que lo escribiste bien (ej. nombre@gmail.com)")

    existente = db.query(Usuario).filter_by(email=email).first()
    if existente and existente.estado != "sin_verificar":
        raise HTTPException(409, "Ya existe una cuenta con ese correo")
    if existente:
        # Registro a medias (nunca confirmo el codigo): solo se reenvia el codigo. NO se pisan sus datos:
        # si no, alguien podria registrar el correo de otra persona con una clave suya y, cuando la
        # victima pusiera el codigo que le llego, la cuenta quedaria verificada con la clave del atacante.
        codigos.emitir(db, existente, "verificar")
        return {"mensaje": "Te reenviamos el codigo a tu correo", "email": email}

    con_cedula = db.query(Usuario).filter_by(cedula=cedula).first()
    if con_cedula and con_cedula.estado == "sin_verificar":
        # Registro abandonado: nunca confirmo su correo (por ejemplo lo escribio mal y el codigo no llego).
        # Se borra para no dejar la cedula bloqueada; una cuenta sin verificar no da acceso a nada.
        db.delete(con_cedula)
        db.commit()
    elif con_cedula:
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


@app.post("/registro/reenviar")
def registro_reenviar(datos: ReenviarIn, db: Session = Depends(get_db)):
    """Pide otro codigo (con 60 s de espera). Respuesta igual exista o no la cuenta."""
    u = db.query(Usuario).filter_by(email=datos.email.strip().lower()).first()
    if u and u.estado == "sin_verificar":
        codigos.emitir(db, u, "verificar")
    return {"mensaje": "Si el correo tiene un registro pendiente, te enviamos un codigo nuevo"}


@app.post("/recuperar")
def recuperar(datos: ReenviarIn, db: Session = Depends(get_db)):
    """Envia un codigo para poner una clave nueva. Siempre responde igual: asi no se puede usar este
    formulario para averiguar que correos tienen cuenta."""
    u = db.query(Usuario).filter_by(email=datos.email.strip().lower()).first()
    if u and u.estado != "sin_verificar":
        try:
            codigos.emitir(db, u, "recuperar")
        except HTTPException as e:
            log.warning("Recuperar clave de %s no se envio: %s", u.email, e.detail)
    return {"mensaje": "Si el correo tiene una cuenta, te enviamos un codigo para recuperar tu clave"}


@app.post("/recuperar/confirmar")
def recuperar_confirmar(datos: RecuperarConfirmarIn, db: Session = Depends(get_db)):
    u = db.query(Usuario).filter_by(email=datos.email.strip().lower()).first()
    if not u or u.estado == "sin_verificar":
        raise HTTPException(400, "El codigo venció o no existe. Pide uno nuevo.")
    codigos.validar(db, u, "recuperar", datos.codigo)
    u.password_hash = hash_password(datos.nueva_clave)
    db.commit()
    return {"mensaje": "Clave actualizada. Ya puedes iniciar sesion."}


@app.post("/login")
def login(datos: LoginIn, db: Session = Depends(get_db)):
    u = db.query(Usuario).filter_by(email=datos.email.strip().lower()).first()
    if not u or not verify_password(datos.password, u.password_hash):
        raise HTTPException(401, "Correo o clave incorrectos")
    # El estado se revela SOLO despues de acertar la clave: quien no la sabe no aprende nada de la cuenta
    if u.estado == "sin_verificar":
        # "accion" le dice al frontend que muestre la pantalla para poner el codigo
        return JSONResponse(status_code=403, content={
            "detail": "Falta confirmar tu correo. Te enviamos un codigo.", "accion": "verificar", "email": u.email})
    if u.estado == "en_espera":
        raise HTTPException(403, "Tu cuenta de profesor esta en lista de espera: un administrador debe aprobarla")
    if u.estado == "rechazado":
        raise HTTPException(403, "Un administrador no aprobo tu cuenta de profesor")
    if u.estado != "activo":
        raise HTTPException(403, "Tu cuenta esta desactivada")
    return {"token": crear_token(u, datos.recordarme), "usuario": a_json(u)}


@app.get("/me")
def me(user: dict = Depends(usuario_actual), db: Session = Depends(get_db)):
    u = db.get(Usuario, int(user["sub"]))
    if not u:
        raise HTTPException(404, "Usuario no existe")
    return a_json(u)


@app.get("/usuarios")
def listar(rol: Optional[str] = None, _=Depends(solo_interno), db: Session = Depends(get_db)):
    q = db.query(Usuario)
    if rol:
        q = q.filter_by(rol=rol)
    return [a_json(u) for u in q.order_by(Usuario.rol.desc(), Usuario.nombre).all()]


# ----------------------------------------------------------------- administrador general
@app.get("/admin/profesores")
def admin_profesores(estado: Optional[str] = None, _=Depends(solo_admin), db: Session = Depends(get_db)):
    """Profesores registrados; con ?estado=en_espera, la lista de espera por aprobar."""
    q = db.query(Usuario).filter_by(rol="profesor")
    if estado:
        q = q.filter_by(estado=estado)
    return [a_json(u) for u in q.order_by(Usuario.creado_en).all()]


def resolver_profesor(uid: int, aprobar: bool, tareas: BackgroundTasks, db: Session) -> dict:
    u = db.get(Usuario, uid)
    if not u or u.rol != "profesor":
        raise HTTPException(404, "Profesor no existe")
    if u.estado != "en_espera":
        raise HTTPException(409, "Este profesor no esta en la lista de espera")
    u.estado = "activo" if aprobar else "rechazado"
    db.commit()
    tareas.add_task(avisar_resolucion, a_json(u), aprobar)
    return a_json(u)


def avisar_resolucion(profesor: dict, aprobado: bool):
    """Python -> Go: le cuenta al profesor (campanita + correo) lo que decidio el admin."""
    try:
        httpx.post(f"{NOTIF_URL}/interno/notificar", headers={"X-Internal-Token": INTERNAL_TOKEN}, timeout=10, json={
            "usuarioId": profesor["id"], "email": profesor["email"], "nombre": profesor["nombre"],
            "titulo": "Tu cuenta de profesor fue aprobada" if aprobado else "Tu cuenta de profesor no fue aprobada",
            "mensaje": "Ya puedes iniciar sesion, crear tus materias y secciones y recibir solicitudes de estudiantes."
                       if aprobado else "Un administrador no aprobo tu solicitud de cuenta de profesor.",
            "enlace": PUBLIC_URL, "enviarCorreo": True,
        })
    except httpx.HTTPError as e:
        log.warning("No se pudo avisar al profesor %s: %s", profesor["email"], e)


@app.post("/admin/profesores/{uid}/aprobar")
def admin_aprobar(uid: int, tareas: BackgroundTasks, _=Depends(solo_admin), db: Session = Depends(get_db)):
    return resolver_profesor(uid, True, tareas, db)


@app.post("/admin/profesores/{uid}/rechazar")
def admin_rechazar(uid: int, tareas: BackgroundTasks, _=Depends(solo_admin), db: Session = Depends(get_db)):
    return resolver_profesor(uid, False, tareas, db)


@app.get("/admin/usuarios")
def admin_usuarios(rol: Optional[str] = None, _=Depends(solo_admin), db: Session = Depends(get_db)):
    q = db.query(Usuario)
    if rol:
        q = q.filter_by(rol=rol)
    return [a_json(u) for u in q.order_by(Usuario.rol, Usuario.nombre).all()]


@app.patch("/admin/usuarios/{uid}")
def admin_cambiar_estado(uid: int, datos: EstadoIn, user=Depends(solo_admin), db: Session = Depends(get_db)):
    """Activar o desactivar una cuenta. Solo se pasa entre 'activo' y 'desactivado'."""
    u = db.get(Usuario, uid)
    if not u:
        raise HTTPException(404, "Usuario no existe")
    if u.id == int(user["sub"]):
        raise HTTPException(400, "No puedes desactivar tu propia cuenta")
    if u.estado in ("sin_verificar", "en_espera", "rechazado"):
        raise HTTPException(409, "Esta cuenta aun no esta aprobada; usa la lista de espera")
    u.estado = datos.estado
    db.commit()
    return a_json(u)


@app.delete("/admin/usuarios/{uid}", status_code=204)
def admin_eliminar(uid: int, user=Depends(solo_admin), db: Session = Depends(get_db)):
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
