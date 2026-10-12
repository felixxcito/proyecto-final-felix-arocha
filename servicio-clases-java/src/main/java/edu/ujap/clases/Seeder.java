package edu.ujap.clases;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/** Carga los temas de la materia desde temas-semilla.json la primera vez que arranca. */
@Component
public class Seeder implements CommandLineRunner {
  private final ClaseRepo repo;

  public Seeder(ClaseRepo repo) { this.repo = repo; }

  @Override
  public void run(String... args) throws Exception {
    if (repo.count() > 0) return;
    JsonNode temas = new ObjectMapper().readTree(new ClassPathResource("temas-semilla.json").getInputStream());
    for (JsonNode t : temas) {
      Clase c = new Clase();
      c.setSemana(t.get("semana").asInt());
      c.setTitulo(t.get("titulo").asText());
      c.setDescripcion(t.path("descripcion").asText(""));
      repo.save(c);
    }
  }
}
