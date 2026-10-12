package edu.ujap.clases;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.*;
import java.util.HashSet;
import java.util.Set;

/** Seccion de una materia (ej. Seccion 01) con sus estudiantes inscritos. */
@Entity
public class Seccion {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false)
  private String nombre;
  private String horario;

  @JsonIgnore
  @ManyToOne(optional = false)
  @JoinColumn(name = "materia_id")
  private Materia materia;

  /** IDs de los estudiantes (los usuarios viven en el servicio de auth en Python). */
  @ElementCollection(fetch = FetchType.EAGER)
  @CollectionTable(name = "seccion_estudiante", joinColumns = @JoinColumn(name = "seccion_id"))
  @Column(name = "estudiante_id")
  private Set<Long> estudiantes = new HashSet<>();

  public Long getId() { return id; }
  public String getNombre() { return nombre; }
  public void setNombre(String nombre) { this.nombre = nombre; }
  public String getHorario() { return horario; }
  public void setHorario(String horario) { this.horario = horario; }
  public Materia getMateria() { return materia; }
  public void setMateria(Materia materia) { this.materia = materia; }
  public Long getMateriaId() { return materia == null ? null : materia.getId(); }
  public Set<Long> getEstudiantes() { return estudiantes; }
  public void setEstudiantes(Set<Long> estudiantes) { this.estudiantes = estudiantes; }
}
