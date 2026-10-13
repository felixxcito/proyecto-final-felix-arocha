package edu.ujap.clases;

import io.jsonwebtoken.Claims;
import java.time.Instant;
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

  // ----------------------------------------------------------------- ver solicitudes
  /** Una solicitud lista para mostrar: con el nombre de la seccion y la materia (la entidad no los trae). */
  private Map<String, Object> aMapa(Solicitud sol) {
    Seccion s = sol.getSeccion();
    Map<String, Object> x = new LinkedHashMap<>();
    x.put("id", sol.getId());
    x.put("estado", sol.getEstado());
    x.put("estudianteId", sol.getEstudianteId());
    x.put("estudianteNombre", sol.getEstudianteNombre());
    x.put("estudianteCedula", sol.getEstudianteCedula());
    x.put("estudianteEmail", sol.getEstudianteEmail());
    x.put("seccionId", s.getId());
    x.put("seccionNombre", s.getNombre());
    x.put("horario", s.getHorario());
    x.put("materiaId", s.getMateria().getId());
    x.put("materiaNombre", s.getMateria().getNombre());
    x.put("profesorNombre", s.getMateria().getProfesorNombre());
    x.put("creadaEn", sol.getCreadaEn());
    x.put("resueltaEn", sol.getResueltaEn());
    return x;
  }

  @GetMapping("/solicitudes")
  public List<Map<String, Object>> listar(@RequestParam(value = "estado", required = false) String estado,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.usuario(h);
    Long uid = Long.valueOf(u.getSubject());
    List<Solicitud> lista = new ArrayList<>();
    if (auth.esProfesor(u)) {
      // Solo las de las secciones de SUS materias
      for (Materia m : materias.findAllByOrderByNombreAsc())
        if (Objects.equals(m.getProfesorId(), uid)) lista.addAll(solicitudes.findBySeccion_Materia_IdOrderByCreadaEnDesc(m.getId()));
      lista.sort(Comparator.comparing(Solicitud::getCreadaEn).reversed());
    } else {
      lista.addAll(solicitudes.findByEstudianteIdOrderByCreadaEnDesc(uid));
    }
    return lista.stream().filter(sol -> estado == null || estado.equalsIgnoreCase(sol.getEstado())).map(this::aMapa).toList();
  }

  // ----------------------------------------------------------------- aprobar o rechazar
  @PutMapping("/solicitudes/{id}")
  public Map<String, Object> resolver(@PathVariable Long id, @RequestBody ResolucionIn in,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Solicitud sol = solicitudes.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "La solicitud no existe"));
    Seccion s = sol.getSeccion();
    Materia m = s.getMateria();
    acceso.exigirDueno(Long.valueOf(u.getSubject()), m);   // solo el profesor de esa materia decide
    if (!"PENDIENTE".equals(sol.getEstado()))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Esa solicitud ya fue resuelta");
    if (in.aprobar() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Indica si apruebas o rechazas");

    sol.setEstado(in.aprobar() ? "APROBADA" : "RECHAZADA");
    sol.setResueltaEn(Instant.now());
    solicitudes.save(sol);

    if (in.aprobar()) {
      s.getEstudiantes().add(sol.getEstudianteId());   // entra a la seccion
      secciones.save(s);
      // Java -> Node: recalcula quien ve cada clase publicada; el nuevo recibe sus preguntas
      acceso.sincronizarMateria(m.getId());
    }
    notif.avisar(sol.getEstudianteId(), sol.getEstudianteEmail(), sol.getEstudianteNombre(),
        in.aprobar() ? "Te aceptaron en " + m.getNombre() : "No te aceptaron en " + m.getNombre(),
        in.aprobar() ? m.getProfesorNombre() + " aprobo tu inscripcion en " + s.getNombre() + ". Ya puedes ver sus clases."
                     : m.getProfesorNombre() + " no aprobo tu inscripcion en " + s.getNombre() + ".",
        "#/clases");
    return aMapa(sol);
  }
}
