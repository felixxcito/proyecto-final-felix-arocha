package edu.ujap.clases;

import io.jsonwebtoken.Claims;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/**
 * Materias y secciones — Java + Spring Data JPA (@OneToMany / @ManyToOne / @ElementCollection)
 *
 * Gateway: https://localhost/api/clases/...
 *   GET    /materias                       -> profesor: las suyas; estudiante: solo donde esta inscrito
 *   POST   /materias                       -> crear materia
 *   PUT    /materias/{id}                  -> editar
 *   DELETE /materias/{id}                  -> eliminar (si no tiene temas)
 *   POST   /materias/{id}/secciones        -> crear seccion
 *   PUT    /secciones/{id}                 -> editar seccion
 *   DELETE /secciones/{id}                 -> eliminar seccion
 *   PUT    /secciones/{id}/estudiantes     -> inscribir estudiantes (reemplaza la lista)
 * Internos (Python -> Java):
 *   POST   /interno/inscribir              -> inscribir un estudiante recien creado
 *   DELETE /interno/estudiantes/{id}       -> sacar a un estudiante eliminado de sus secciones
 */
@RestController
public class MateriaController {
  private final MateriaRepo materias;
  private final SeccionRepo secciones;
  private final ClaseRepo clases;
  private final SolicitudRepo solicitudes;
  private final Auth auth;
  private final Acceso acceso;

  public MateriaController(MateriaRepo materias, SeccionRepo secciones, ClaseRepo clases, SolicitudRepo solicitudes,
      Auth auth, Acceso acceso) {
    this.materias = materias;
    this.secciones = secciones;
    this.clases = clases;
    this.solicitudes = solicitudes;
    this.auth = auth;
    this.acceso = acceso;
  }

  record MateriaIn(String nombre, String codigo, String descripcion) {}
  record SeccionIn(String nombre, String horario) {}
  record EstudiantesIn(List<Long> estudiantes) {}
  record InscripcionIn(Long estudianteId, List<Long> secciones) {}

  // ----------------------------------------------------------------- materias
  @GetMapping("/materias")
  public List<Map<String, Object>> listar(@RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.usuario(h);
    boolean profe = auth.esProfesor(u);
    Long uid = Long.valueOf(u.getSubject());
    List<Map<String, Object>> resultado = new ArrayList<>();
    for (Materia m : materias.findAllByOrderByNombreAsc()) {
      // Un profesor solo ve SUS materias (las de otros profesores no existen para el)
      if (profe && !Objects.equals(m.getProfesorId(), uid)) continue;
      // El estudiante solo ve sus secciones y no ve la lista de compañeros
      List<Map<String, Object>> secs = m.getSecciones().stream()
          .filter(s -> profe || s.getEstudiantes().contains(uid))
          .map(s -> {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("id", s.getId());
            x.put("nombre", s.getNombre());
            x.put("horario", s.getHorario());
            x.put("materiaId", m.getId());
            x.put("estudiantes", profe ? s.getEstudiantes() : List.of());
            // Solo el profesor ve quienes son (nombre, cedula y correo, copiados de su solicitud aprobada)
            x.put("estudiantesDetalle", profe ? detalleDe(s) : List.of());
            return x;
          }).toList();
      if (!profe && secs.isEmpty()) continue;
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

  /** Los estudiantes inscritos de una seccion con sus datos, tomados de sus solicitudes aprobadas. */
  private List<Map<String, Object>> detalleDe(Seccion s) {
    Map<Long, Solicitud> porEstudiante = new LinkedHashMap<>();
    for (Solicitud sol : solicitudes.findBySeccion_IdAndEstado(s.getId(), "APROBADA")) porEstudiante.put(sol.getEstudianteId(), sol);
    List<Map<String, Object>> detalle = new ArrayList<>();
    for (Long id : s.getEstudiantes()) {
      Solicitud sol = porEstudiante.get(id);
      Map<String, Object> x = new LinkedHashMap<>();
      x.put("id", id);
      x.put("nombre", sol == null ? "Estudiante " + id : sol.getEstudianteNombre());
      x.put("cedula", sol == null ? null : sol.getEstudianteCedula());
      x.put("email", sol == null ? null : sol.getEstudianteEmail());
      detalle.add(x);
    }
    detalle.sort(Comparator.comparing(x -> String.valueOf(x.get("nombre"))));
    return detalle;
  }

  @PostMapping("/materias")
  public ResponseEntity<Materia> crear(@RequestBody MateriaIn in, @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Materia m = new Materia();
    aplicar(m, in);
    // El dueno es quien crea la materia: sale del token firmado, nunca de lo que mande el cliente
    m.setProfesorId(Long.valueOf(u.getSubject()));
    m.setProfesorNombre(u.get("nombre", String.class));
    m.setProfesorEmail(u.get("email", String.class));
    return ResponseEntity.status(201).body(materias.save(m));
  }

  @PutMapping("/materias/{id}")
  public Materia editar(@PathVariable Long id, @RequestBody MateriaIn in,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Materia m = materia(id);
    acceso.exigirDueno(Long.valueOf(u.getSubject()), m);
    aplicar(m, in);
    return materias.save(m);
  }

  @Transactional
  @DeleteMapping("/materias/{id}")
  public ResponseEntity<Void> eliminar(@PathVariable Long id, @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Materia m = materia(id);
    acceso.exigirDueno(Long.valueOf(u.getSubject()), m);
    if (clases.existsByMateriaId(id))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "La materia tiene temas: muevelos o eliminalos primero");
    for (Seccion s : m.getSecciones()) solicitudes.deleteBySeccion_Id(s.getId());
    materias.delete(m);
    return ResponseEntity.noContent().build();
  }

  // ----------------------------------------------------------------- secciones
  @PostMapping("/materias/{id}/secciones")
  public ResponseEntity<Seccion> crearSeccion(@PathVariable Long id, @RequestBody SeccionIn in,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Materia m = materia(id);
    acceso.exigirDueno(Long.valueOf(u.getSubject()), m);
    Seccion s = new Seccion();
    s.setMateria(m);
    aplicar(s, in);
    return ResponseEntity.status(201).body(secciones.save(s));
  }

  @PutMapping("/secciones/{id}")
  public Seccion editarSeccion(@PathVariable Long id, @RequestBody SeccionIn in,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Seccion s = seccion(id);
    acceso.exigirDueno(Long.valueOf(u.getSubject()), s.getMateria());
    aplicar(s, in);
    return secciones.save(s);
  }

  @Transactional
  @DeleteMapping("/secciones/{id}")
  public ResponseEntity<Void> eliminarSeccion(@PathVariable Long id,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Seccion s = seccion(id);
    Materia m = s.getMateria();
    acceso.exigirDueno(Long.valueOf(u.getSubject()), m);
    solicitudes.deleteBySeccion_Id(id);   // la FK solicitud.seccion_id exige borrarlas antes
    m.getSecciones().remove(s); // orphanRemoval borra la fila al terminar la transaccion
    secciones.flush();
    acceso.sincronizarMateria(m.getId());
    return ResponseEntity.noContent().build();
  }

  /** Inscribe exactamente estos estudiantes en la seccion y actualiza el acceso a las clases publicadas. */
  @PutMapping("/secciones/{id}/estudiantes")
  public Seccion inscribir(@PathVariable Long id, @RequestBody EstudiantesIn in,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Seccion s = seccion(id);
    acceso.exigirDueno(Long.valueOf(u.getSubject()), s.getMateria());
    s.setEstudiantes(new HashSet<>(Optional.ofNullable(in.estudiantes()).orElse(List.of())));
    secciones.save(s);
    acceso.sincronizarMateria(s.getMateriaId());
    return s;
  }

  // ----------------------------------------------------------------- internos (Python -> Java)
  @PostMapping("/interno/inscribir")
  public Map<String, Object> inscribirInterno(@RequestBody InscripcionIn in,
      @RequestHeader(value = "X-Internal-Token", required = false) String t) {
    auth.interno(t);
    Set<Long> materiasTocadas = new HashSet<>();
    for (Long sid : Optional.ofNullable(in.secciones()).orElse(List.of())) {
      secciones.findById(sid).ifPresent(s -> {
        s.getEstudiantes().add(in.estudianteId());
        secciones.save(s);
        materiasTocadas.add(s.getMateriaId());
      });
    }
    materiasTocadas.forEach(acceso::sincronizarMateria);
    return Map.of("materias", materiasTocadas.size());
  }

  @DeleteMapping("/interno/estudiantes/{id}")
  public ResponseEntity<Void> sacarEstudiante(@PathVariable Long id,
      @RequestHeader(value = "X-Internal-Token", required = false) String t) {
    auth.interno(t);
    for (Seccion s : secciones.deEstudiante(id)) {
      s.getEstudiantes().remove(id);
      secciones.save(s);
    }
    return ResponseEntity.noContent().build();
  }

  // ----------------------------------------------------------------- utilidades
  private Materia materia(Long id) {
    return materias.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Materia no existe"));
  }

  private Seccion seccion(Long id) {
    return secciones.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Seccion no existe"));
  }

  private void aplicar(Materia m, MateriaIn in) {
    if (in.nombre() == null || in.nombre().isBlank())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre de la materia es obligatorio");
    m.setNombre(in.nombre().trim());
    m.setCodigo(in.codigo() == null ? null : in.codigo().trim());
    m.setDescripcion(in.descripcion());
  }

  private void aplicar(Seccion s, SeccionIn in) {
    if (in.nombre() == null || in.nombre().isBlank())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El nombre de la seccion es obligatorio");
    s.setNombre(in.nombre().trim());
    s.setHorario(in.horario() == null ? null : in.horario().trim());
  }
}
