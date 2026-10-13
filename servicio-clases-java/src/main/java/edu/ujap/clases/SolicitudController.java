package edu.ujap.clases;

import io.jsonwebtoken.Claims;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * Catalogo de materias y solicitudes de inscripcion — Java + Spring Data JPA
 *
 * Gateway: https://localhost/api/clases/...
 *   GET  /catalogo                -> (estudiante) materias de todos los profesores con sus secciones y horarios
 *   POST /solicitudes             -> (estudiante) pedir inscripcion en una seccion
 *   GET  /solicitudes             -> profesor: las de sus secciones · estudiante: las suyas
 *   PUT  /solicitudes/{id}        -> (profesor dueno) aprobar o rechazar
 */
@RestController
public class SolicitudController {
  private final MateriaRepo materias;
  private final SeccionRepo secciones;
  private final SolicitudRepo solicitudes;
  private final Auth auth;
  private final Acceso acceso;
  private final NotifCliente notif;

  public SolicitudController(MateriaRepo materias, SeccionRepo secciones, SolicitudRepo solicitudes, Auth auth,
      Acceso acceso, NotifCliente notif) {
    this.materias = materias;
    this.secciones = secciones;
    this.solicitudes = solicitudes;
    this.auth = auth;
    this.acceso = acceso;
    this.notif = notif;
  }

  record SolicitudIn(Long seccionId) {}
  record ResolucionIn(Boolean aprobar) {}

  // ----------------------------------------------------------------- catalogo
  @GetMapping("/catalogo")
  public List<Map<String, Object>> catalogo(@RequestHeader(value = "Authorization", required = false) String h) {
    Long uid = Long.valueOf(auth.estudiante(h).getSubject());
    // Ultimo estado de las solicitudes del estudiante por seccion (la mas reciente gana)
    Map<Long, String> ultima = new HashMap<>();
    for (Solicitud s : solicitudes.findByEstudianteIdOrderByCreadaEnDesc(uid)) ultima.putIfAbsent(s.getSeccionId(), s.getEstado());

    List<Map<String, Object>> resultado = new ArrayList<>();
    for (Materia m : materias.findAllByOrderByNombreAsc()) {
      if (m.getProfesorId() == null) continue;
      List<Map<String, Object>> secs = new ArrayList<>();
      for (Seccion s : m.getSecciones()) {
        Map<String, Object> x = new LinkedHashMap<>();
        x.put("id", s.getId());
        x.put("nombre", s.getNombre());
        x.put("horario", s.getHorario());
        // INSCRITO | PENDIENTE | RECHAZADA | null (todavia no la ha pedido)
        x.put("estado", s.getEstudiantes().contains(uid) ? "INSCRITO" : ultima.get(s.getId()));
        secs.add(x);
      }
      Map<String, Object> x = new LinkedHashMap<>();
      x.put("id", m.getId());
      x.put("nombre", m.getNombre());
      x.put("codigo", m.getCodigo());
      x.put("descripcion", m.getDescripcion());
      x.put("profesorNombre", m.getProfesorNombre());
      x.put("secciones", secs);
      resultado.add(x);
    }
    return resultado;
  }

  // ----------------------------------------------------------------- pedir inscripcion
  @PostMapping("/solicitudes")
  public ResponseEntity<Solicitud> solicitar(@RequestBody SolicitudIn in,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.estudiante(h);
    Long uid = Long.valueOf(u.getSubject());
    Seccion s = in.seccionId() == null ? null : secciones.findById(in.seccionId()).orElse(null);
    if (s == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Esa seccion no existe");
    if (s.getEstudiantes().contains(uid))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Ya estas inscrito en esa seccion");
    if (solicitudes.existsBySeccion_IdAndEstudianteIdAndEstado(s.getId(), uid, "PENDIENTE"))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Ya tienes una solicitud pendiente en esa seccion");

    // Nombre, cedula y correo salen del token firmado: el estudiante no puede inventarlos
    Solicitud sol = new Solicitud();
    sol.setSeccion(s);
    sol.setEstudianteId(uid);
    sol.setEstudianteNombre(u.get("nombre", String.class));
    sol.setEstudianteCedula(u.get("cedula", String.class));
    sol.setEstudianteEmail(u.get("email", String.class));
    solicitudes.save(sol);

    Materia m = s.getMateria();
    notif.avisar(m.getProfesorId(), m.getProfesorEmail(), m.getProfesorNombre(),
        "Nueva solicitud de inscripcion",
        sol.getEstudianteNombre() + " (cedula " + sol.getEstudianteCedula() + ") pidio inscribirse en "
            + m.getNombre() + ", " + s.getNombre() + ".", "#/solicitudes");
    return ResponseEntity.status(201).body(sol);
  }
}
