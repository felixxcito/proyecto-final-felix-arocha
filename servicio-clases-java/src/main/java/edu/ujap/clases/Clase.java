package edu.ujap.clases;

import jakarta.persistence.*;
import java.time.Instant;

/** Entidad JPA: Hibernate crea la tabla "clase" automaticamente (ddl-auto=update). */
@Entity
@org.hibernate.annotations.DynamicUpdate // el UPDATE solo incluye las columnas que cambiaron
public class Clase {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  /** Materia a la que pertenece el tema */
  private Long materiaId;

  /** Secciones que pueden ver la clase (vacio = todas las secciones de la materia) */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "clase_seccion", joinColumns = @JoinColumn(name = "clase_id"))
  @Column(name = "seccion_id")
  private java.util.Set<Long> secciones = new java.util.HashSet<>();

  private Integer semana;
  private String titulo;

  @Column(columnDefinition = "TEXT")
  private String descripcion;

  // Presentacion subida por el profesor
  private String archivoNombre;
  private String archivoRuta;
  private String archivoTipo;

  /** PDF que se muestra en el visor (el original si era PDF, o la conversion del PPTX). */
  private String pdfRuta;
  /** NINGUNA | CONVIRTIENDO | LISTA | ERROR */
  private String vistaEstado = "NINGUNA";

  /** SIN_MATERIAL -> PROCESANDO -> BORRADOR -> PUBLICADA  (o ERROR) */
  private String estado = "SIN_MATERIAL";

  @Column(columnDefinition = "TEXT")
  private String mensajeEstado;

  /** Clase privada: solo los estudiantes que el profesor marco en la lista de asistencia */
  @Column(nullable = false, columnDefinition = "boolean default false")
  private boolean privada = false;

  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "clase_asistente", joinColumns = @JoinColumn(name = "clase_id"))
  @Column(name = "estudiante_id")
  private java.util.Set<Long> asistentes = new java.util.HashSet<>();

  /** Cuantas preguntas genera la IA para cada estudiante */
  @Column(nullable = false, columnDefinition = "integer default 5")
  private int preguntasPorEstudiante = 5;

  private Instant publicadaEn;
  private Instant actualizadaEn = Instant.now();

  @PreUpdate
  void alActualizar() { actualizadaEn = Instant.now(); }

  public Long getId() { return id; }
  public Long getMateriaId() { return materiaId; }
  public void setMateriaId(Long materiaId) { this.materiaId = materiaId; }
  public java.util.Set<Long> getSecciones() { return secciones; }
  public void setSecciones(java.util.Set<Long> secciones) { this.secciones = secciones; }
  public Integer getSemana() { return semana; }
  public void setSemana(Integer semana) { this.semana = semana; }
  public String getTitulo() { return titulo; }
  public void setTitulo(String titulo) { this.titulo = titulo; }
  public String getDescripcion() { return descripcion; }
  public void setDescripcion(String descripcion) { this.descripcion = descripcion; }
  public String getArchivoNombre() { return archivoNombre; }
  public void setArchivoNombre(String archivoNombre) { this.archivoNombre = archivoNombre; }
  @com.fasterxml.jackson.annotation.JsonIgnore
  public String getArchivoRuta() { return archivoRuta; }
  public void setArchivoRuta(String archivoRuta) { this.archivoRuta = archivoRuta; }
  public String getArchivoTipo() { return archivoTipo; }
  public void setArchivoTipo(String archivoTipo) { this.archivoTipo = archivoTipo; }
  @com.fasterxml.jackson.annotation.JsonIgnore
  public String getPdfRuta() { return pdfRuta; }
  public void setPdfRuta(String pdfRuta) { this.pdfRuta = pdfRuta; }
  public String getVistaEstado() { return vistaEstado; }
  public void setVistaEstado(String vistaEstado) { this.vistaEstado = vistaEstado; }
  public String getEstado() { return estado; }
  public void setEstado(String estado) { this.estado = estado; }
  public String getMensajeEstado() { return mensajeEstado; }
  public void setMensajeEstado(String mensajeEstado) { this.mensajeEstado = mensajeEstado; }
  public boolean isPrivada() { return privada; }
  public void setPrivada(boolean privada) { this.privada = privada; }
  public java.util.Set<Long> getAsistentes() { return asistentes; }
  public void setAsistentes(java.util.Set<Long> asistentes) { this.asistentes = asistentes; }
  public int getPreguntasPorEstudiante() { return preguntasPorEstudiante; }
  public void setPreguntasPorEstudiante(int n) { this.preguntasPorEstudiante = n; }

  public Instant getPublicadaEn() { return publicadaEn; }
  public void setPublicadaEn(Instant publicadaEn) { this.publicadaEn = publicadaEn; }
  public Instant getActualizadaEn() { return actualizadaEn; }
}
