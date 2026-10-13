"""Encriptacion de claves (bcrypt) y tokens JWT."""
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException

SECRET_KEY = os.getenv("SECRET_KEY")
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN")
ALGORITHM = "HS256"
EXPIRA_HORAS = 12
EXPIRA_HORAS_RECORDADO = 24 * 30   # "Recordarme": 30 dias


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def crear_token(usuario, recordarme: bool = False) -> str:
    payload = {
        "sub": str(usuario.id),
        "email": usuario.email,
        "nombre": usuario.nombre,
        "cedula": usuario.cedula,
        "rol": usuario.rol,
        "exp": datetime.now(timezone.utc) + timedelta(hours=EXPIRA_HORAS_RECORDADO if recordarme else EXPIRA_HORAS),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def usuario_actual(authorization: str = Header(default="")) -> dict:
    """Lee el header Authorization: Bearer <token> y devuelve el payload."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "Falta el token")
    try:
        return jwt.decode(authorization[7:], SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(401, "Token invalido o vencido")


def solo_profesor(user: dict = Depends(usuario_actual)) -> dict:
    if user["rol"] != "profesor":
        raise HTTPException(403, "Solo un profesor puede hacer esto")
    return user


def solo_admin(user: dict = Depends(usuario_actual)) -> dict:
    if user["rol"] != "admin":
        raise HTTPException(403, "Solo el administrador puede hacer esto")
    return user


def solo_interno(x_internal_token: str = Header(default="")) -> dict:
    """Solo otro microservicio (con el INTERNAL_TOKEN del .env). Ningun usuario del navegador lo conoce."""
    if not x_internal_token or x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(403, "Solo servicios internos")
    return {"rol": "interno"}


def token_de(authorization: str, uri_original: str) -> str | None:
    """Saca el token del header Authorization o, si no hay, del ?token= de la URL (el visor de PDF
    lo manda asi porque pdf.js no puede poner headers)."""
    if authorization.startswith("Bearer "):
        return authorization[7:]
    valores = parse_qs(urlparse(uri_original).query).get("token")
    return valores[0] if valores else None
