package edu.ujap.clases;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import java.time.Instant;

/** Un estudiante pide inscribirse en una seccion; el profesor dueno la aprueba o la rechaza. */
@Entity
public class Solicitud {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  /** Clave foranea REAL: la seccion vive en esta misma base de datos. */
  @JsonIgnore
  @ManyToOne(optional = false)
  @JoinColumn(name = "seccion_id")
  private Seccion seccion;

  /** ID del usuario en el servicio de auth (referencia logica: otra base de datos). */
  @Column(nullable = false)
  private Long estudianteId;
  // Copia de los datos del estudiante, tomada del token: el profesor los ve sin consultar a Python
  private String estudianteNombre;
  private String estudianteCedula;
  private String estudianteEmail;

  /** PENDIENTE | APROBADA | RECHAZADA */
  @Column(nullable = false)
  private String estado = "PENDIENTE";

  private Instant creadaEn = Instant.now();
  private Instant resueltaEn;

  public Long getId() { return id; }
  public Seccion getSeccion() { return seccion; }
  public void setSeccion(Seccion seccion) { this.seccion = seccion; }
  public Long getSeccionId() { return seccion == null ? null : seccion.getId(); }
  public Long getEstudianteId() { return estudianteId; }
  public void setEstudianteId(Long estudianteId) { this.estudianteId = estudianteId; }
  public String getEstudianteNombre() { return estudianteNombre; }
  public void setEstudianteNombre(String v) { this.estudianteNombre = v; }
  public String getEstudianteCedula() { return estudianteCedula; }
  public void setEstudianteCedula(String v) { this.estudianteCedula = v; }
  public String getEstudianteEmail() { return estudianteEmail; }
  public void setEstudianteEmail(String v) { this.estudianteEmail = v; }
  public String getEstado() { return estado; }
  public void setEstado(String estado) { this.estado = estado; }
  public Instant getCreadaEn() { return creadaEn; }
  public Instant getResueltaEn() { return resueltaEn; }
  public void setResueltaEn(Instant resueltaEn) { this.resueltaEn = resueltaEn; }
}
