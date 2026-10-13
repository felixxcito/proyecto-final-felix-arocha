package edu.ujap.clases;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Valida el JWT que emite el servicio de auth (Python) con la misma SECRET_KEY. */
@Component
public class Auth {
  private final SecretKey key;
  private final String internalToken;

  public Auth(@Value("${app.secret}") String secret, @Value("${app.internal-token}") String internalToken) {
    this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    this.internalToken = internalToken;
  }

  public Claims usuario(String header) {
    String token = header != null && header.startsWith("Bearer ") ? header.substring(7) : header;
    if (token == null || token.isBlank()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Falta el token");
    try {
      return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Token invalido");
    }
  }

  public boolean esProfesor(Claims c) { return "profesor".equals(c.get("rol", String.class)); }

  public Claims profesor(String header) {
    Claims c = usuario(header);
    if (!esProfesor(c)) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un profesor");
    return c;
  }

  public Claims estudiante(String header) {
    Claims c = usuario(header);
    if (!"estudiante".equals(c.get("rol", String.class))) throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo un estudiante");
    return c;
  }

  public void interno(String token) {
    if (token == null || !token.equals(internalToken))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Solo servicios internos");
  }
}
