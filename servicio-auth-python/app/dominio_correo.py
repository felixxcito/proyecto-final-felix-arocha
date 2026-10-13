"""Comprueba que el dominio de un correo (lo que va despues de la @) puede recibir mensajes."""
import logging

import dns.exception
import dns.resolver

log = logging.getLogger("uvicorn.error")

TIMEOUT_SEG = 3


def dominio_recibe_correo(correo: str) -> bool:
    """False solo si el DNS dice con seguridad que el dominio NO existe o NO recibe correo
    (por ejemplo 'nombre@gmail.con'). Esto no prueba que el buzon exista: eso lo prueba el codigo
    de 6 digitos que se envia despues, porque Gmail no deja preguntar si un buzon existe.

    Si el DNS no responde (sin internet, tiempo agotado) devuelve True: un fallo ajeno al usuario
    no debe impedirle registrarse."""
    dominio = correo.rsplit("@", 1)[-1].strip().lower().rstrip(".")
    try:
        # Un dominio recibe correo si tiene registros MX...
        respuesta = dns.resolver.resolve(dominio, "MX", lifetime=TIMEOUT_SEG)
        # ...salvo el "MX nulo" (un solo MX con destino "."), que declara que NO recibe correo (RFC 7505)
        return any(str(r.exchange).rstrip(".") for r in respuesta)
    except (dns.resolver.NXDOMAIN, dns.exception.SyntaxError):
        # SyntaxError: el dominio esta mal formado ('a@b..com', etiquetas vacias o demasiado largas)
        return False
    except dns.resolver.NoAnswer:
        # Existe pero sin MX: segun el RFC 5321 el correo va entonces a su registro A/AAAA
        for tipo in ("A", "AAAA"):
            try:
                dns.resolver.resolve(dominio, tipo, lifetime=TIMEOUT_SEG)
                return True
            except dns.exception.DNSException:
                continue
        return False
    except dns.exception.DNSException as e:
        log.warning("No se pudo consultar el DNS de %s (%s); se acepta el correo", dominio, type(e).__name__)
        return True
