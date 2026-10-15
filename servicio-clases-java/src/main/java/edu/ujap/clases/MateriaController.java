package edu.ujap.clases;

import io.jsonwebtoken.Claims;
import java.io.IOException;
import java.nio.file.*;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
 *   DELETE /secciones/{id}/estudiantes/{eid} -> dar de baja a un estudiante
 * Internos (Python -> Java):
 *   DELETE /interno/estudiantes/{id}       -> sacar a un estudiante eliminado de sus secciones
 *   DELETE /interno/profesores/{id}        -> profesor eliminado: borrar sus materias con todo lo que tienen
 *   GET    /interno/profesores/{pid}/estudiantes/{eid} -> 204 si el estudiante esta en una seccion del profesor
 */
@RestController
public class MateriaController {
  private static final Logger log = LoggerFactory.getLogger(MateriaController.class);
  private final MateriaRepo materias;
  private final SeccionRepo secciones;
  private final ClaseRepo clases;
  private final SolicitudRepo solicitudes;
  private final Auth auth;
  private final Acceso acceso;
  private final IaCliente ia;

  public MateriaController(MateriaRepo materias, SeccionRepo secciones, ClaseRepo clases, SolicitudRepo solicitudes,
      Auth auth, Acceso acceso, IaCliente ia) {
    this.materias = materias;
    this.secciones = secciones;
    this.clases = clases;
    this.solicitudes = solicitudes;
    this.auth = auth;
    this.acceso = acceso;
    this.ia = ia;
  }

  record MateriaIn(String nombre, String codigo, String descripcion) {}
  record SeccionIn(String nombre, String horario) {}

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

  /** El profesor da de baja a un estudiante de su seccion (pierde el acceso a las clases de esa materia). */
  @DeleteMapping("/secciones/{id}/estudiantes/{estudianteId}")
  public ResponseEntity<Void> quitarEstudiante(@PathVariable Long id, @PathVariable Long estudianteId,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Seccion s = seccion(id);
    acceso.exigirDueno(Long.valueOf(u.getSubject()), s.getMateria());
    if (!s.getEstudiantes().remove(estudianteId))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Ese estudiante no esta en la seccion");
    secciones.save(s);
    acceso.sincronizarMateria(s.getMateriaId());
    return ResponseEntity.noContent().build();
  }

  // ----------------------------------------------------------------- internos (Python -> Java)
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

  /** Profesor eliminado: se borran sus materias con todo lo que tienen (secciones, solicitudes, temas, sus
   *  archivos y el contenido de IA de cada tema). Python lo llama ANTES de borrar la cuenta: si esto falla,
   *  la cuenta no se borra y no quedan materias sin dueno. */
  @Transactional
  @DeleteMapping("/interno/profesores/{id}")
  public ResponseEntity<Void> borrarProfesor(@PathVariable Long id,
      @RequestHeader(value = "X-Internal-Token", required = false) String t) {
    auth.interno(t);
    for (Materia m : materias.findByProfesorId(id)) {
      for (Clase c : clases.findByMateriaId(m.getId())) {
        borrarArchivo(c.getArchivoRuta());
        borrarArchivo(c.getPdfRuta());
        clases.delete(c);
        try {
          ia.delete("/interno/clases/" + c.getId());
        } catch (Exception e) {
          log.warn("No se pudo borrar el contenido IA de la clase {}: {}", c.getId(), e.getMessage());
        }
      }
      for (Seccion s : m.getSecciones()) solicitudes.deleteBySeccion_Id(s.getId());
      materias.delete(m);
    }
    return ResponseEntity.noContent().build();
  }

  /** Python pregunta si el estudiante esta inscrito en alguna seccion del profesor antes de mostrarle su perfil. */
  @Transactional(readOnly = true)
  @GetMapping("/interno/profesores/{profesorId}/estudiantes/{estudianteId}")
  public ResponseEntity<Void> esSuEstudiante(@PathVariable Long profesorId, @PathVariable Long estudianteId,
      @RequestHeader(value = "X-Internal-Token", required = false) String t) {
    auth.interno(t);
    boolean es = secciones.deEstudiante(estudianteId).stream()
        .anyMatch(s -> profesorId.equals(s.getMateria().getProfesorId()));
    return es ? ResponseEntity.noContent().build() : ResponseEntity.notFound().build();
  }

  // ----------------------------------------------------------------- utilidades
  private static void borrarArchivo(String ruta) {
    if (ruta == null) return;
    try {
      Files.deleteIfExists(Path.of(ruta));
    } catch (IOException e) {
      log.warn("No se pudo borrar el archivo {}: {}", ruta, e.getMessage());
    }
  }

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
