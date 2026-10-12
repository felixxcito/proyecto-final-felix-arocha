package edu.ujap.clases;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Comunicacion Java -> Node (servicio-ia) por la red interna de Docker. */
@Component
public class IaCliente {
  private final RestClient http;

  public IaCliente(@Value("${app.ia-url}") String url, @Value("${app.internal-token}") String token) {
    this.http = RestClient.builder()
        .baseUrl(url)
        .defaultHeader("X-Internal-Token", token)
        .build();
  }

  public void post(String ruta, Map<String, Object> cuerpo) {
    http.post().uri(ruta).contentType(MediaType.APPLICATION_JSON).body(cuerpo).retrieve().toBodilessEntity();
  }

  public void delete(String ruta) {
    http.delete().uri(ruta).retrieve().toBodilessEntity();
  }
}
