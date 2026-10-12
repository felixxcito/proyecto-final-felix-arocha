package edu.ujap.clases;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class ClasesApplication {
  public static void main(String[] args) {
    SpringApplication.run(ClasesApplication.class, args);
  }
}
