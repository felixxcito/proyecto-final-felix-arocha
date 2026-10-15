package edu.ujap.clases;

import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;

/** Materia que dicta un profesor (cualquiera: Fisica, Contabilidad, Programacion...). Tiene varias secciones. */
@Entity
public class Materia {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false)
  private String nombre;
  private String codigo;

  @Column(columnDefinition = "TEXT")
  private String descripcion;

  /** Profesor dueno de la materia. Es el ID del usuario en el servicio de auth (referencia logica: otra base). */
  private Long profesorId;
  // Copia del nombre y el correo para mostrarlos a los estudiantes en el catalogo sin consultar a Python
  private String profesorNombre;
  private String profesorEmail;

  /** Relacion uno-a-muchos: al borrar la materia se borran sus secciones (cascade + orphanRemoval). */
  @OneToMany(mappedBy = "materia", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.EAGER)
  @OrderBy("nombre ASC")
  private List<Seccion> secciones = new ArrayList<>();

  public Long getId() { return id; }
  public String getNombre() { return nombre; }
  public void setNombre(String nombre) { this.nombre = nombre; }
  public String getCodigo() { return codigo; }
  public void setCodigo(String codigo) { this.codigo = codigo; }
  public String getDescripcion() { return descripcion; }
  public void setDescripcion(String descripcion) { this.descripcion = descripcion; }
  public Long getProfesorId() { return profesorId; }
  public void setProfesorId(Long profesorId) { this.profesorId = profesorId; }
  public String getProfesorNombre() { return profesorNombre; }
  public void setProfesorNombre(String profesorNombre) { this.profesorNombre = profesorNombre; }
  public String getProfesorEmail() { return profesorEmail; }
  public void setProfesorEmail(String profesorEmail) { this.profesorEmail = profesorEmail; }
  public List<Seccion> getSecciones() { return secciones; }
}
