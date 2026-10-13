"""Codigos de 6 digitos que se envian por correo (verificar la cuenta, recuperar la clave)."""
import hashlib
import secrets

import httpx
from fastapi import HTTPException

from .security import INTERNAL_TOKEN

NOTIF_URL = "http://servicio-notificaciones:8080"


def generar_codigo() -> str:
    """6 digitos con ceros a la izquierda ('004821'). secrets es aleatorio criptografico (random no lo es)."""
    return f"{secrets.randbelow(10**6):06d}"


def hash_codigo(codigo: str) -> str:
    """sha256 del codigo. Un codigo de 6 digitos tiene solo un millon de combinaciones, asi que el hash
    no es una proteccion fuerte por si solo: la proteccion real es que vence en 10 minutos y se bloquea a los 5 intentos."""
    return hashlib.sha256(codigo.encode()).hexdigest()


def enviar_correo(email: str, nombre: str, asunto: str, mensaje: str) -> None:
    """Python -> Go: pide que envie el correo y ESPERA el resultado. Si no salio, el usuario debe saberlo
    (un codigo que nunca llega dejaria al usuario esperando para siempre)."""
    try:
        r = httpx.post(f"{NOTIF_URL}/interno/correo", timeout=30, headers={"X-Internal-Token": INTERNAL_TOKEN},
                       json={"email": email, "nombre": nombre, "asunto": asunto, "mensaje": mensaje})
    except httpx.HTTPError:
        raise HTTPException(502, "No se pudo contactar al servicio de correo")
    if r.status_code != 200:
        raise HTTPException(502, "No se pudo enviar el correo. Revisa que el correo este bien escrito.")
