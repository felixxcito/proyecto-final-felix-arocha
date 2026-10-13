package edu.ujap.clases;

import java.util.HashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Java -> Go: avisa a un usuario (campanita + correo) por la red interna de Docker. */
@Component
public class NotifCliente {
  private static final Logger log = LoggerFactory.getLogger(NotifCliente.class);
  private final RestClient http;
  private final String publicUrl;

  public NotifCliente(@Value("${app.notif-url}") String url, @Value("${app.internal-token}") String token,
      @Value("${app.public-url}") String publicUrl) {
    this.http = RestClient.builder().baseUrl(url).defaultHeader("X-Internal-Token", token).build();
    this.publicUrl = publicUrl;
  }

  /** Un aviso que falle no debe romper la accion principal (aprobar una solicitud, por ejemplo): solo se registra. */
  public void avisar(Long usuarioId, String email, String nombre, String titulo, String mensaje, String ruta) {
    Map<String, Object> cuerpo = new HashMap<>();
    cuerpo.put("usuarioId", usuarioId);
    cuerpo.put("email", email);
    cuerpo.put("nombre", nombre);
    cuerpo.put("titulo", titulo);
    cuerpo.put("mensaje", mensaje);
    cuerpo.put("enlace", publicUrl + "/app.html" + ruta);
    cuerpo.put("enviarCorreo", true);
    try {
      http.post().uri("/interno/notificar").contentType(MediaType.APPLICATION_JSON).body(cuerpo)
          .retrieve().toBodilessEntity();
    } catch (Exception e) {
      log.warn("No se pudo avisar a {}: {}", email, e.getMessage());
    }
  }
}
