package edu.ujap.clases;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** Spring Data JPA genera findAll(), save(), findById(), deleteById()... automaticamente. */
@Repository
public interface ClaseRepo extends JpaRepository<Clase, Long> {
  List<Clase> findAllByOrderBySemanaAscIdAsc();

  /** Actualiza solo la vista, sin pisar el estado que escribe el servicio de IA al mismo tiempo. */
  @Transactional
  @Modifying
  @Query("update Clase c set c.pdfRuta = :ruta, c.vistaEstado = :estado where c.id = :id")
  void actualizarVista(@Param("id") Long id, @Param("ruta") String ruta, @Param("estado") String estado);
}
