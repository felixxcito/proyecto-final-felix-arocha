package edu.ujap.clases;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

@Repository
public interface SeccionRepo extends JpaRepository<Seccion, Long> {
  /** Secciones donde esta inscrito un estudiante (JPQL "member of" sobre la coleccion). */
  @Query("select s from Seccion s where :estudianteId member of s.estudiantes")
  List<Seccion> deEstudiante(@Param("estudianteId") Long estudianteId);

  /** "_" indica que se navega la relacion: seccion.materia.id */
  List<Seccion> findByMateria_Id(Long materiaId);
}
