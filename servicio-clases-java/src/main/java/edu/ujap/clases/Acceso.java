package edu.ujap.clases;

import java.util.*;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Reglas de acceso de los estudiantes a una clase:
 *   inscrito en una de las secciones de la clase  +  clase publicada  +  (si es privada) en la lista de asistencia.
 * Tambien sincroniza con el servicio de IA quien puede ver cada clase publicada.
 */
@Component
public class Acceso {
  private static final Logger log = LoggerFactory.getLogger(Acceso.class);
  private final SeccionRepo secciones;
  private final ClaseRepo clases;
  private final IaCliente ia;

  public Acceso(SeccionRepo secciones, ClaseRepo clases, IaCliente ia) {
    this.secciones = secciones;
    this.clases = clases;
    this.ia = ia;
  }

  /** Un profesor solo puede tocar lo que es suyo: 403 si la materia pertenece a otro. */
  public void exigirDueno(Long profesorId, Materia m) {
    if (m == null || !Objects.equals(m.getProfesorId(), profesorId))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Esta materia no es tuya");
  }

  /** Secciones para las que es visible la clase: las elegidas, o todas las de su materia. */
  public List<Seccion> seccionesDe(Clase c) {
    if (c.getMateriaId() == null) return List.of();
    List<Seccion> deLaMateria = secciones.findByMateria_Id(c.getMateriaId());
    if (c.getSecciones().isEmpty()) return deLaMateria;
    return deLaMateria.stream().filter(s -> c.getSecciones().contains(s.getId())).toList();
  }

  /** Estudiantes inscritos en las secciones de la clase. */
  public Set<Long> inscritos(Clase c) {
    return seccionesDe(c).stream().flatMap(s -> s.getEstudiantes().stream()).collect(Collectors.toSet());
  }

  /** Estudiantes que pueden ver la clase una vez publicada. */
  public Set<Long> permitidos(Clase c) {
    Set<Long> ids = new HashSet<>(inscritos(c));
    if (c.isPrivada()) ids.retainAll(c.getAsistentes());
    return ids;
  }

  public boolean estaInscrito(Long estudianteId, Clase c) {
    return inscritos(c).contains(estudianteId);
  }

  public boolean puedeVer(Long estudianteId, Clase c) {
    return "PUBLICADA".equals(c.getEstado()) && permitidos(c).contains(estudianteId);
  }

  /** Java -> Node: quien tiene acceso; Node genera las preguntas de los nuevos y les avisa (Node -> Go). */
  public void sincronizar(Clase c) {
    ia.post("/interno/asignar", Map.of(
        "claseId", c.getId(),
        "titulo", c.getTitulo(),
        "privada", c.isPrivada(),
        "permitidos", permitidos(c),
        "preguntasPorEstudiante", c.getPreguntasPorEstudiante()));
  }

  /** Despues de cambiar inscripciones: re-sincroniza las clases publicadas de esa materia. */
  public void sincronizarMateria(Long materiaId) {
    for (Clase c : clases.findByMateriaIdAndEstado(materiaId, "PUBLICADA")) {
      try {
        sincronizar(c);
      } catch (Exception e) {
        log.warn("No se pudo sincronizar la clase {} con servicio-ia: {}", c.getId(), e.getMessage());
      }
    }
  }
}
