package edu.ujap.clases;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * Datos iniciales: la materia LPR07304 con la Seccion 01 y los temas de temas-semilla.json.
 * Los temas que no tengan materia (versiones anteriores) se asignan a la primera materia.
 */
@Component
public class Seeder implements CommandLineRunner {
  private final ClaseRepo repo;
  private final MateriaRepo materias;
  private final SeccionRepo secciones;

  public Seeder(ClaseRepo repo, MateriaRepo materias, SeccionRepo secciones) {
    this.repo = repo;
    this.materias = materias;
    this.secciones = secciones;
  }

  @Override
  public void run(String... args) throws Exception {
    Materia base = materias.findAllByOrderByNombreAsc().stream().findFirst().orElseGet(() -> {
      Materia m = new Materia();
      m.setNombre("Lenguajes de Programación");
      m.setCodigo("LPR07304");
      m = materias.save(m);
      Seccion s = new Seccion();
      s.setNombre("Sección 01");
      s.setMateria(m);
      secciones.save(s);
      return m;
    });
    for (Clase c : repo.findAll()) {
      if (c.getMateriaId() == null) {
        c.setMateriaId(base.getId());
        repo.save(c);
      }
    }
    if (repo.count() > 0) return;
    JsonNode temas = new ObjectMapper().readTree(new ClassPathResource("temas-semilla.json").getInputStream());
    for (JsonNode t : temas) {
      Clase c = new Clase();
      c.setSemana(t.get("semana").asInt());
      c.setTitulo(t.get("titulo").asText());
      c.setDescripcion(t.path("descripcion").asText(""));
      c.setMateriaId(base.getId());
      repo.save(c);
    }
  }
}
