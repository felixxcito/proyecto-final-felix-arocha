package edu.ujap.clases;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface MateriaRepo extends JpaRepository<Materia, Long> {
  List<Materia> findAllByOrderByNombreAsc();
}
