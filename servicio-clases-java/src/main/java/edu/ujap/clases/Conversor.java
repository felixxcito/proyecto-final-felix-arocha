package edu.ujap.clases;

import java.nio.file.*;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;

/** Convierte PPTX a PDF con LibreOffice (en segundo plano) para mostrar las diapositivas en el navegador. */
@Component
public class Conversor {
  private static final Logger log = LoggerFactory.getLogger(Conversor.class);
  private final ClaseRepo repo;

  public Conversor(ClaseRepo repo) { this.repo = repo; }

  @Async
  public void convertir(Long claseId, Path pptx) {
    Path pdf = pptx.resolveSibling(pptx.getFileName().toString().replaceAll("\\.pptx$", ".pdf"));
    try {
      Files.deleteIfExists(pdf);
      Process p = new ProcessBuilder("soffice", "--headless", "--convert-to", "pdf",
          "--outdir", pptx.getParent().toString(), pptx.toString())
          .redirectErrorStream(true).start();
      boolean termino = p.waitFor(180, TimeUnit.SECONDS);
      if (!termino) p.destroyForcibly();
      if (termino && Files.exists(pdf)) {
        repo.actualizarVista(claseId, pdf.toString(), "LISTA");
        log.info("Clase {}: PPTX convertido a PDF", claseId);
        return;
      }
      log.warn("Clase {}: LibreOffice no genero el PDF: {}", claseId, new String(p.getInputStream().readAllBytes()));
    } catch (Exception e) {
      log.warn("Clase {}: error convirtiendo PPTX: {}", claseId, e.getMessage());
    }
    repo.actualizarVista(claseId, null, "ERROR");
  }
}
