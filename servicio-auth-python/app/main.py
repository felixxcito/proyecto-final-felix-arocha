"""
Microservicio de AUTENTICACION y USUARIOS — Python + FastAPI + SQLAlchemy + PostgreSQL

Gateway: http://localhost/api/auth/...
  POST   /login               -> token JWT
  GET    /me                  -> datos del usuario del token
  GET    /usuarios            -> lista (profesora o servicio interno), filtro ?rol=
  POST   /usuarios            -> crear usuario (solo profesora), opcionalmente inscrito en secciones
  PATCH  /usuarios/{id}       -> editar / activar / cambiar clave
  DELETE /usuarios/{id}       -> eliminar
"""
import logging
import os
from typing import Optional

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .database import Base, SessionLocal, Usuario, engine, get_db
from .security import (
    INTERNAL_TOKEN,
    crear_token,
    hash_password,
    profesora_o_interno,
    solo_profesora,
    usuario_actual,
    verify_password,
)

log = logging.getLogger("uvicorn.error")
app = FastAPI(title="Servicio Auth (Python)")

CLASES_URL = "http://servicio-clases:8080"
NOTIF_URL = "http://servicio-notificaciones:8080"
PUBLIC_URL = os.getenv("PUBLIC_URL", "http://localhost")


# ----------------------------------------------------------------- arranque
@app.on_event("startup")
def iniciar():
    Base.metadata.create_all(engine)  # crea la tabla usuarios si no existe
    with SessionLocal() as db:
        email = os.getenv("ADMIN_EMAIL", "").strip().lower()
        if email and not db.query(Usuario).filter_by(email=email).first():
            db.add(Usuario(
                nombre=os.getenv("ADMIN_NOMBRE", "Profesora"),
                email=email,
                password_hash=hash_password(os.getenv("ADMIN_PASSWORD", "cambiame")),
                rol="profesora",
            ))
            db.commit()
            log.info("Usuario profesora creado: %s", email)


# ----------------------------------------------------------------- esquemas
class LoginIn(BaseModel):
    email: str
    password: str


class UsuarioIn(BaseModel):
    nombre: str = Field(min_length=2)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=6)
    rol: str = Field(default="estudiante", pattern="^(estudiante|profesora)$")
    secciones: list[int] = []  # secciones (servicio de clases) donde se inscribe al estudiante


class UsuarioPatch(BaseModel):
    nombre: Optional[str] = None
    password: Optional[str] = Field(default=None, min_length=6)
    activo: Optional[bool] = None


def a_json(u: Usuario) -> dict:
    # password_hash jamas sale del servicio
    return {"id": u.id, "nombre": u.nombre, "email": u.email, "rol": u.rol,
            "activo": u.activo, "creado_en": u.creado_en.isoformat() if u.creado_en else None}


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
            "mensaje": f"Tu profesora creo tu cuenta con el correo {u['email']}. "
                       "Entra con la clave que ella te entrego.",
            "enlace": PUBLIC_URL, "enviarCorreo": True,
        })
    except httpx.HTTPError as e:
        log.warning("No se pudo avisar a servicio-notificaciones: %s", e)


# ----------------------------------------------------------------- endpoints
@app.get("/health")
def health():
    return {"servicio": "auth", "lenguaje": "Python / FastAPI", "orm": "SQLAlchemy",
            "bd": "PostgreSQL", "estado": "ok"}


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
def listar(rol: Optional[str] = None, _=Depends(profesora_o_interno), db: Session = Depends(get_db)):
    q = db.query(Usuario)
    if rol:
        q = q.filter_by(rol=rol)
    return [a_json(u) for u in q.order_by(Usuario.rol.desc(), Usuario.nombre).all()]


@app.post("/usuarios", status_code=201)
def crear(datos: UsuarioIn, tareas: BackgroundTasks, _=Depends(solo_profesora),
          db: Session = Depends(get_db)):
    email = datos.email.strip().lower()
    if db.query(Usuario).filter_by(email=email).first():
        raise HTTPException(409, "Ya existe un usuario con ese correo")
    u = Usuario(nombre=datos.nombre.strip(), email=email,
                password_hash=hash_password(datos.password), rol=datos.rol)
    db.add(u)
    db.commit()
    db.refresh(u)
    if u.rol == "estudiante":
        tareas.add_task(avisar_estudiante_nuevo, a_json(u), datos.secciones)
    return a_json(u)


@app.patch("/usuarios/{uid}")
def editar(uid: int, datos: UsuarioPatch, user=Depends(solo_profesora), db: Session = Depends(get_db)):
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
        u.activo = datos.activo
    db.commit()
    return a_json(u)


@app.delete("/usuarios/{uid}", status_code=204)
def eliminar(uid: int, user=Depends(solo_profesora), db: Session = Depends(get_db)):
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
