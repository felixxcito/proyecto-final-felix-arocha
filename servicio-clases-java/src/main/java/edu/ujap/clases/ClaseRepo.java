package edu.ujap.clases;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/** Spring Data JPA genera findAll(), save(), findById(), deleteById()... automaticamente. */
@Repository
public interface ClaseRepo extends JpaRepository<Clase, Long> {
  List<Clase> findAllByOrderBySemanaAscIdAsc();
}
