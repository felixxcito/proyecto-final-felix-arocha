package edu.ujap.clases;

import io.jsonwebtoken.Claims;
import java.io.IOException;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

/**
 * Microservicio de CLASES — Java + Spring Boot + Spring Data JPA + PostgreSQL
 *
 * Gateway: https://localhost/api/clases/...
 *   GET    /temas                     -> profesor: los suyos; estudiante: los de sus secciones
 *   GET    /temas/{id}
 *   POST   /temas                     -> crear tema (profesor)
 *   PUT    /temas/{id}                -> editar tema (profesor)
 *   DELETE /temas/{id}                -> eliminar (profesor)
 *   POST   /temas/{id}/presentacion   -> subir PDF/PPTX; se envia a servicio-ia
 *   GET    /temas/{id}/archivo        -> descargar / ver la presentacion
 *   POST   /temas/{id}/publicar       -> publicar a estudiantes (genera preguntas)
 *   PUT    /temas/{id}/configuracion  -> privada, lista de asistencia, preguntas por estudiante
 *   PATCH  /interno/temas/{id}/estado -> servicio-ia avisa que termino de procesar
 */
@RestController
public class ClaseController {
  private static final Logger log = LoggerFactory.getLogger(ClaseController.class);
  private static final Set<String> EXTENSIONES = Set.of("pdf", "pptx");

  private final ClaseRepo repo;
  private final Auth auth;
  private final IaCliente ia;
  private final Conversor conversor;
  private final Acceso acceso;
  private final MateriaRepo materias;
  private final Path uploads;

  public ClaseController(ClaseRepo repo, Auth auth, IaCliente ia, Conversor conversor, Acceso acceso,
      MateriaRepo materias, @Value("${app.uploads}") String uploads) throws IOException {
    this.repo = repo;
    this.auth = auth;
    this.ia = ia;
    this.conversor = conversor;
    this.acceso = acceso;
    this.materias = materias;
    this.uploads = Files.createDirectories(Path.of(uploads));
  }

  record TemaIn(Integer semana, String titulo, String descripcion, Long materiaId, List<Long> secciones) {}
  record EstadoIn(String estado, String mensaje) {}
  record ConfiguracionIn(Boolean privada, List<Long> asistentes, Integer preguntasPorEstudiante) {}

  @GetMapping("/health")
  public Map<String, String> health() {
    return Map.of("servicio", "clases", "lenguaje", "Java / Spring Boot", "orm", "Spring Data JPA",
        "bd", "PostgreSQL", "estado", "ok");
  }

  // ----------------------------------------------------------------- lectura
  @GetMapping("/temas")
  public List<Clase> listar(@RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.usuario(h);
    List<Clase> todas = repo.findAllByOrderBySemanaAscIdAsc();
    Long uid = Long.valueOf(u.getSubject());
    // El profesor ve solo los temas de SUS materias; el estudiante, los de sus secciones
    if (auth.esProfesor(u)) return todas.stream().filter(c -> esMia(uid, c)).toList();
    return todas.stream().filter(c -> acceso.estaInscrito(uid, c)).toList();
  }

  @GetMapping("/temas/{id}")
  public Clase obtener(@PathVariable Long id, @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.usuario(h);
    Clase c = buscar(id);
    if (auth.esProfesor(u)) exigirDueno(u, c);
    else if (!acceso.estaInscrito(Long.valueOf(u.getSubject()), c))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Esta clase no es de tu seccion");
    return c;
  }

  /** Acepta el token por header o por ?token= (para poder abrirlo en un iframe / pestana). */
  @GetMapping("/temas/{id}/archivo")
  public ResponseEntity<FileSystemResource> archivo(@PathVariable Long id,
      @RequestHeader(value = "Authorization", required = false) String h,
      @RequestParam(value = "token", required = false) String token) {
    Claims u = auth.usuario(h != null ? h : token);
    Clase c = buscar(id);
    if (c.getArchivoRuta() == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Sin presentacion");
    verificarAcceso(u, c);
    MediaType tipo = "pdf".equals(c.getArchivoTipo()) ? MediaType.APPLICATION_PDF
        : MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    String disposicion = "pdf".equals(c.getArchivoTipo()) ? "inline" : "attachment";
    return ResponseEntity.ok()
        .contentType(tipo)
        .header(HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.builder(disposicion).filename(c.getArchivoNombre(), java.nio.charset.StandardCharsets.UTF_8).build().toString())
        .body(new FileSystemResource(c.getArchivoRuta()));
  }

  /** PDF para el visor de diapositivas (pdf.js en el navegador). */
  @GetMapping("/temas/{id}/diapositivas.pdf")
  public ResponseEntity<FileSystemResource> pdf(@PathVariable Long id,
      @RequestHeader(value = "Authorization", required = false) String h,
      @RequestParam(value = "token", required = false) String token) {
    Claims u = auth.usuario(h != null ? h : token);
    Clase c = buscar(id);
    verificarAcceso(u, c);
    // Las presentaciones PDF subidas antes de existir el visor no tienen pdfRuta: se usa el original
    String ruta = c.getPdfRuta() != null ? c.getPdfRuta() : ("pdf".equals(c.getArchivoTipo()) ? c.getArchivoRuta() : null);
    if (ruta == null || !Files.exists(Path.of(ruta)))
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "La vista de diapositivas aun no esta lista");
    return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF)
        .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300")
        .body(new FileSystemResource(ruta));
  }

  // ----------------------------------------------------------------- CRUD profesor
  @PostMapping("/temas")
  public ResponseEntity<Clase> crear(@RequestBody TemaIn in, @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Clase c = new Clase();
    aplicar(c, in, Long.valueOf(u.getSubject()));
    return ResponseEntity.status(201).body(repo.save(c));
  }

  @PutMapping("/temas/{id}")
  public Clase editar(@PathVariable Long id, @RequestBody TemaIn in,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Clase c = buscar(id);
    exigirDueno(u, c);
    aplicar(c, in, Long.valueOf(u.getSubject()));
    repo.save(c);
    if ("PUBLICADA".equals(c.getEstado())) acceso.sincronizar(c); // pudieron cambiar las secciones
    return c;
  }

  @DeleteMapping("/temas/{id}")
  public ResponseEntity<Void> eliminar(@PathVariable Long id,
      @RequestHeader(value = "Authorization", required = false) String h) throws IOException {
    Claims u = auth.profesor(h);
    Clase c = buscar(id);
    exigirDueno(u, c);
    if (c.getArchivoRuta() != null) Files.deleteIfExists(Path.of(c.getArchivoRuta()));
    if (c.getPdfRuta() != null) Files.deleteIfExists(Path.of(c.getPdfRuta()));
    repo.delete(c);
    try {
      ia.delete("/interno/clases/" + id);
    } catch (Exception e) {
      log.warn("No se pudo borrar el contenido IA de la clase {}: {}", id, e.getMessage());
    }
    return ResponseEntity.noContent().build();
  }

  // ----------------------------------------------------------------- presentacion + IA
  @PostMapping("/temas/{id}/presentacion")
  public Clase subir(@PathVariable Long id, @RequestParam("archivo") MultipartFile archivo,
      @RequestHeader(value = "Authorization", required = false) String h) throws IOException {
    Claims u = auth.profesor(h);
    Clase c = buscar(id);
    exigirDueno(u, c);
    String nombre = Optional.ofNullable(archivo.getOriginalFilename()).orElse("presentacion");
    String ext = nombre.contains(".") ? nombre.substring(nombre.lastIndexOf('.') + 1).toLowerCase() : "";
    if (!EXTENSIONES.contains(ext))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Solo se aceptan archivos PDF o PPTX");

    Path destino = uploads.resolve("clase-" + id + "." + ext);
    if (c.getArchivoRuta() != null) Files.deleteIfExists(Path.of(c.getArchivoRuta()));
    if (c.getPdfRuta() != null && !c.getPdfRuta().equals(c.getArchivoRuta())) Files.deleteIfExists(Path.of(c.getPdfRuta()));
    archivo.transferTo(destino);
    boolean esPdf = "pdf".equals(ext);
    c.setPdfRuta(esPdf ? destino.toString() : null);
    c.setVistaEstado(esPdf ? "LISTA" : "CONVIRTIENDO");

    c.setArchivoNombre(nombre);
    c.setArchivoRuta(destino.toString());
    c.setArchivoTipo(ext);
    c.setEstado("PROCESANDO");
    c.setMensajeEstado("La IA esta leyendo la presentacion...");
    repo.save(c);
    if (!esPdf) conversor.convertir(id, destino); // PPTX -> PDF con LibreOffice, en segundo plano

    // Java -> Node: el servicio de IA responde 202 y procesa en segundo plano
    try {
      ia.post("/interno/procesar", Map.of(
          "claseId", id,
          "titulo", c.getTitulo(),
          "descripcion", Optional.ofNullable(c.getDescripcion()).orElse(""),
          "nombreArchivo", nombre,
          "tipo", ext,
          "base64", Base64.getEncoder().encodeToString(Files.readAllBytes(destino))));
    } catch (Exception e) {
      c.setEstado("ERROR");
      c.setMensajeEstado("El servicio de IA no respondio: " + e.getMessage());
      repo.save(c);
    }
    return c;
  }

  @PostMapping("/temas/{id}/publicar")
  public Clase publicar(@PathVariable Long id, @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Clase c = buscar(id);
    exigirDueno(u, c);
    if (!"BORRADOR".equals(c.getEstado()) && !"PUBLICADA".equals(c.getEstado()))
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Primero sube la presentacion y espera a que la IA termine");
    if (c.getMateriaId() == null)
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Asigna una materia al tema antes de publicarlo");
    String estadoAnterior = c.getEstado();
    c.setEstado("PUBLICADA");
    c.setMensajeEstado("Publicada. Generando preguntas para cada estudiante...");
    if (c.getPublicadaEn() == null) c.setPublicadaEn(Instant.now());
    repo.save(c); // se guarda antes de llamar a Node, que actualizara el mensaje al terminar
    // Java -> Node: genera preguntas distintas para cada estudiante con acceso y les avisa (Node -> Go)
    try {
      acceso.sincronizar(c);
    } catch (Exception e) {
      c.setEstado(estadoAnterior);
      c.setMensajeEstado("El servicio de IA no respondio: " + e.getMessage());
      repo.save(c);
      throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "El servicio de IA no respondio");
    }
    return c;
  }

  /** Node -> Java: el servicio de IA informa el resultado del procesamiento. */
  @PatchMapping("/interno/temas/{id}/estado")
  public Clase estado(@PathVariable Long id, @RequestBody EstadoIn in,
      @RequestHeader(value = "X-Internal-Token", required = false) String t) {
    auth.interno(t);
    Clase c = buscar(id);
    // Si ya habia sido publicada y se re-subio la presentacion, vuelve a quedar publicada
    boolean yaPublicada = c.getPublicadaEn() != null && "BORRADOR".equals(in.estado());
    c.setEstado(yaPublicada ? "PUBLICADA" : in.estado());
    c.setMensajeEstado(in.mensaje());
    return repo.save(c);
  }

  /**
   * Configuracion de la clase: privada + lista de asistencia + cantidad de preguntas.
   * Si ya esta publicada, Java -> Node asigna preguntas a los estudiantes que acaban de recibir acceso.
   */
  @PutMapping("/temas/{id}/configuracion")
  public Clase configurar(@PathVariable Long id, @RequestBody ConfiguracionIn in,
      @RequestHeader(value = "Authorization", required = false) String h) {
    Claims u = auth.profesor(h);
    Clase c = buscar(id);
    exigirDueno(u, c);
    if (in.privada() != null) c.setPrivada(in.privada());
    if (in.asistentes() != null) c.setAsistentes(new HashSet<>(in.asistentes()));
    if (in.preguntasPorEstudiante() != null) {
      if (in.preguntasPorEstudiante() < 1 || in.preguntasPorEstudiante() > 20)
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Las preguntas por estudiante deben estar entre 1 y 20");
      c.setPreguntasPorEstudiante(in.preguntasPorEstudiante());
    }
    repo.save(c);
    if ("PUBLICADA".equals(c.getEstado())) {
      try {
        acceso.sincronizar(c);
      } catch (Exception e) {
        throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Se guardo, pero el servicio de IA no respondio");
      }
    }
    return c;
  }

  private void verificarAcceso(Claims u, Clase c) {
    if (auth.esProfesor(u)) {
      exigirDueno(u, c);
      return;
    }
    if (!acceso.puedeVer(Long.valueOf(u.getSubject()), c))
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, c.isPrivada() ? "Clase privada: pidele acceso a tu profesor" : "No tienes acceso a esta clase");
  }

  // ----------------------------------------------------------------- utilidades
  /** Materia a la que pertenece un tema (null si el tema todavia no tiene). */
  private Materia materiaDe(Clase c) {
    return c.getMateriaId() == null ? null : materias.findById(c.getMateriaId()).orElse(null);
  }

  private boolean esMia(Long profesorId, Clase c) {
    Materia m = materiaDe(c);
    return m != null && Objects.equals(m.getProfesorId(), profesorId);
  }

  /** 403 si el tema es de la materia de otro profesor. */
  private void exigirDueno(Claims u, Clase c) {
    acceso.exigirDueno(Long.valueOf(u.getSubject()), materiaDe(c));
  }

  private Clase buscar(Long id) {
    return repo.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Tema no existe"));
  }

  private void aplicar(Clase c, TemaIn in, Long profesorId) {
    if (in.titulo() == null || in.titulo().isBlank())
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El titulo es obligatorio");
    if (in.materiaId() == null || !materias.existsById(in.materiaId()))
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Elige la materia del tema");
    // El tema solo puede ir a una materia del propio profesor (no se puede publicar en la de otro)
    acceso.exigirDueno(profesorId, materias.findById(in.materiaId()).orElse(null));
    c.setSemana(in.semana());
    c.setTitulo(in.titulo().trim());
    c.setDescripcion(in.descripcion());
    c.setMateriaId(in.materiaId());
    c.setSecciones(new HashSet<>(Optional.ofNullable(in.secciones()).orElse(List.of())));
  }
}
