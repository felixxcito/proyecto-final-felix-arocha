# ---- Etapa 1: compilar con Maven
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B package -DskipTests

# ---- Etapa 2: solo el JRE + el .jar
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /src/target/servicio-clases-1.0.0.jar app.jar
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
