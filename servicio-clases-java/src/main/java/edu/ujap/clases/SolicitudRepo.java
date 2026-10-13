package edu.ujap.clases;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface SolicitudRepo extends JpaRepository<Solicitud, Long> {
  /** Solicitudes del estudiante, la mas reciente primero. */
  List<Solicitud> findByEstudianteIdOrderByCreadaEnDesc(Long estudianteId);

  /** Solicitudes de una seccion en un estado (ej. las APROBADAS = los estudiantes inscritos). */
  List<Solicitud> findBySeccion_IdAndEstado(Long seccionId, String estado);

  /** Solicitudes de todas las secciones de una materia (el panel del profesor). */
  List<Solicitud> findBySeccion_Materia_IdOrderByCreadaEnDesc(Long materiaId);

  boolean existsBySeccion_IdAndEstudianteIdAndEstado(Long seccionId, Long estudianteId, String estado);

  /** Al borrar una seccion hay que borrar antes sus solicitudes (la clave foranea lo exige). */
  void deleteBySeccion_Id(Long seccionId);
}
