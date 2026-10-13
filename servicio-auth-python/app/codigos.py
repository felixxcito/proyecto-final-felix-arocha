"""Codigos de 6 digitos que se envian por correo (verificar la cuenta, recuperar la clave)."""
import hashlib
import secrets


def generar_codigo() -> str:
    """6 digitos con ceros a la izquierda ('004821'). secrets es aleatorio criptografico (random no lo es)."""
    return f"{secrets.randbelow(10**6):06d}"


def hash_codigo(codigo: str) -> str:
    """sha256 del codigo. Un codigo de 6 digitos tiene solo un millon de combinaciones, asi que el hash
    no es una proteccion fuerte por si solo: la proteccion real es que vence en 10 minutos y se bloquea a los 5 intentos."""
    return hashlib.sha256(codigo.encode()).hexdigest()
