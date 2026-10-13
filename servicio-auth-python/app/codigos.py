"""Codigos de 6 digitos que se envian por correo (verificar la cuenta, recuperar la clave)."""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from .database import Codigo, Usuario
from .security import INTERNAL_TOKEN

NOTIF_URL = "http://servicio-notificaciones:8080"
EXPIRA_MIN = int(os.getenv("CODIGO_EXPIRA_MIN", "10"))
ESPERA_REENVIO_SEG = 60
MAX_INTENTOS = 5


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


ASUNTOS = {
    "verificar": "Tu codigo de verificacion",
    "recuperar": "Codigo para recuperar tu clave",
}


def emitir(db: Session, usuario: Usuario, proposito: str) -> None:
    """Crea un codigo nuevo para el usuario y lo envia por correo."""
    ahora = datetime.now(timezone.utc)
    previos = db.query(Codigo).filter_by(usuario_id=usuario.id, proposito=proposito, usado=False).all()

    # Espera entre reenvios: evita usar el sistema para llenar de correos a alguien (y gastar el SMTP)
    for c in previos:
        if (ahora - c.creado_en).total_seconds() < ESPERA_REENVIO_SEG:
            falta = ESPERA_REENVIO_SEG - int((ahora - c.creado_en).total_seconds())
            raise HTTPException(429, f"Espera {falta} segundos antes de pedir otro codigo")
        c.usado = True  # el codigo anterior deja de servir: solo vale el ultimo

    codigo = generar_codigo()
    db.add(Codigo(usuario_id=usuario.id, proposito=proposito, codigo_hash=hash_codigo(codigo),
                  expira_en=ahora + timedelta(minutes=EXPIRA_MIN)))
    db.commit()
    enviar_correo(usuario.email, usuario.nombre, ASUNTOS[proposito],
                  f"Tu codigo es {codigo}. Vence en {EXPIRA_MIN} minutos. "
                  "Si no lo pediste tu, ignora este mensaje.")
