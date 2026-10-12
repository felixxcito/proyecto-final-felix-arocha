package edu.ujap.clases;

import jakarta.persistence.*;
import java.time.Instant;

/** Entidad JPA: Hibernate crea la tabla "clase" automaticamente (ddl-auto=update). */
@Entity
public class Clase {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  private Integer semana;
  private String titulo;

  @Column(columnDefinition = "TEXT")
  private String descripcion;

  // Presentacion subida por la profesora
  private String archivoNombre;
  private String archivoRuta;
  private String archivoTipo;

  /** SIN_MATERIAL -> PROCESANDO -> BORRADOR -> PUBLICADA  (o ERROR) */
  private String estado = "SIN_MATERIAL";

  @Column(columnDefinition = "TEXT")
  private String mensajeEstado;

  private Instant publicadaEn;
  private Instant actualizadaEn = Instant.now();

  @PreUpdate
  void alActualizar() { actualizadaEn = Instant.now(); }

  public Long getId() { return id; }
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
  public String getEstado() { return estado; }
  public void setEstado(String estado) { this.estado = estado; }
  public String getMensajeEstado() { return mensajeEstado; }
  public void setMensajeEstado(String mensajeEstado) { this.mensajeEstado = mensajeEstado; }
  public Instant getPublicadaEn() { return publicadaEn; }
  public void setPublicadaEn(Instant publicadaEn) { this.publicadaEn = publicadaEn; }
  public Instant getActualizadaEn() { return actualizadaEn; }
}
