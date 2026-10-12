# Decisión de arquitectura — Aula Virtual LPR

**Proyecto Final LPR07304** · Félix Arocha · Octubre 2026

## Contexto

La Clase 12 pide un sistema web con arquitectura de microservicios:

- 4 microservicios, uno por lenguaje: Python, Node.js, Java y Go.
- Base de datos SQL en al menos 2 servicios y NoSQL en al menos 1.
- Todo en contenedores, levantado con `docker compose up --build`.
- Credenciales en variables de entorno (`.env`), frontend consumiendo las APIs, comunicación entre servicios y README con diagrama.
- Bonus: Nginx como API Gateway.

**Dominio elegido:** un aula virtual para la profesora de la materia. Ella sube la presentación de cada clase, una IA explica cada diapositiva y genera preguntas distintas para cada estudiante, los estudiantes responden y todos reciben notificaciones. La idea es que el proyecto sirva también para explicar cómo se aplicó cada herramienta de la clase.

## Decisión: cuatro servicios, cada uno dueño de sus datos

| Servicio | Tecnología | Base de datos | Responsabilidad | Por qué |
|---|---|---|---|---|
| `servicio-auth` | Python · FastAPI · SQLAlchemy | PostgreSQL `auth_db` | Login, usuarios, roles | Los usuarios son datos relacionales con restricciones (correo único). FastAPI valida las entradas con Pydantic y es sencillo usar bcrypt y JWT. |
| `servicio-clases` | Java · Spring Boot · Spring Data JPA | PostgreSQL `clases_db` | Temas por semana, subida de presentaciones, publicación | Entidades con estados (`SIN_MATERIAL → PROCESANDO → BORRADOR → PUBLICADA`). Spring Data genera el CRUD y Spring maneja bien la subida de archivos. |
| `servicio-ia` | Node.js · Express · Mongoose | MongoDB `aula_ia` | Leer diapositivas, llamar a la IA, preguntas y respuestas | El contenido tiene forma variable (N diapositivas, preguntas anidadas por estudiante): encaja natural en documentos. Node es eficiente esperando respuestas HTTP lentas como las de la IA. |
| `servicio-notificaciones` | Go · Gin · GORM | PostgreSQL `notif_db` | Campanita y correos | Servicio pequeño y muy concurrente; las goroutines envían correos sin bloquear al servicio que pidió la notificación. |
| `gateway` | Nginx | — | Punto de entrada único (`:80`), sirve el frontend | El navegador no conoce puertos internos, no hay problemas de CORS y se cumple el bonus. |

**Una base de datos por servicio** (las tres SQL viven en el mismo contenedor de Postgres, pero separadas): ningún servicio lee las tablas de otro; si necesita un dato, lo pide por HTTP.

## Comunicación entre servicios

- **JWT compartido:** el servicio de auth firma el token con `SECRET_KEY` y los otros tres lo validan localmente con la misma clave, sin llamar a auth en cada petición.
- **Llamadas internas HTTP** por la red de Docker, usando el nombre del servicio como host (`http://servicio-ia:3000`) y protegidas con el header `X-Internal-Token`.
- **Trabajo lento en segundo plano:** cuando Java le envía una presentación a Node, Node responde `202` de inmediato, procesa con la IA y al terminar avisa a Java con un `PATCH`.

## Alternativas consideradas

- **Monolito:** más simple, pero no cumple el requisito de 4 servicios en 4 lenguajes.
- **Cola de mensajes (RabbitMQ):** desacopla mejor, pero agrega otro componente y complejidad para el plazo de entrega; HTTP directo es suficiente para este volumen.
- **Guardar el contenido de la IA en Postgres (JSONB):** posible, pero el requisito de NoSQL y la forma variable del contenido favorecen MongoDB.
- **Validar el token llamando a auth en cada petición:** más acoplamiento y más latencia que validar el JWT localmente.

## Consecuencias

- Si un servicio falla, los demás siguen funcionando (por ejemplo, sin IA se pueden seguir gestionando usuarios y temas).
- **Modo demo:** si no hay API key, el servicio de IA genera contenido con plantillas. Así el sistema siempre levanta y se puede evaluar.
- `healthcheck` + `depends_on: condition: service_healthy` controlan el orden de arranque (las bases de datos primero, el gateway al final).
- Más piezas que configurar: por eso todo se parametriza en un solo `.env` (solo se versiona `.env.example`).
