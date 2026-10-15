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
| `gateway` | Nginx | — | Punto de entrada único (HTTPS en `:443`; el `:80` redirige), sirve el frontend | El navegador no conoce puertos internos, no hay problemas de CORS y se cumple el bonus. |

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

## Decisiones posteriores (durante el desarrollo)

1. **Proveedor de IA configurable.** Conseguimos una key gratuita de NVIDIA, así que el servicio de IA pasó a soportar NVIDIA NIM (por defecto) y Google Gemini, elegidos con `IA_PROVIDER` en el `.env`.
2. **Imágenes propias para Nginx y Postgres.** Montar archivos de la carpeta del proyecto (bind mounts) falló en macOS por permisos; copiar `nginx.conf`, el frontend e `init.sql` dentro de imágenes propias elimina ese riesgo.
3. **Modelos que se retiran.** NVIDIA retiró `llama-3.3-70b-instruct`; pasamos a Gemma 4 y agregamos modelos de respaldo automáticos. Como NVIDIA corta respuestas que tardan más de ~100 s, usamos *streaming* y procesamos las diapositivas en lotes paralelos.
4. **Visor de diapositivas.** El servicio de clases (dueño de los archivos) convierte PPTX a PDF con LibreOffice en segundo plano; el navegador dibuja cada página con pdf.js junto a la explicación de la IA.
5. **Chat por diapositiva.** El servicio de IA responde dudas con el contexto de la diapositiva actual y guarda cada consulta en MongoDB para que la profesora vea qué no se entendió.
6. **Clases privadas y preguntas configurables.** La profesora puede pasar lista y dar acceso solo a los presentes, y elegir cuántas preguntas recibe cada estudiante (1 a 20).
7. **Materias y secciones.** Viven en el servicio de clases (`@OneToMany`, `@ManyToOne`, `@ElementCollection`). Java es la única fuente de verdad sobre quién puede ver cada clase: calcula la lista `permitidos` (sección + asistencia) y se la envía a Node, en vez de que Node consulte secciones por su cuenta.
8. **HTTPS forzado en el gateway.** Nginx escucha en el 443 con un certificado autofirmado generado al construir la imagen, y el puerto 80 redirige con un 301. Así el token JWT y las claves ya no viajan en texto plano entre el navegador y el gateway. Costo: el navegador pide aceptar el certificado la primera vez. No activamos HSTS para no obligar al navegador a usar HTTPS en todo `localhost` (otros proyectos locales usan HTTP). Dentro de la red de Docker los servicios siguen hablando HTTP: esa red es privada y el gateway termina el TLS.
9. **Identidad: registro propio con verificación por correo.** Cualquiera se registra y confirma su correo con un código de 6 dígitos (vence en 10 minutos, máximo 5 intentos, se guarda solo su hash). Se eligió confirmar **solo al registrarse** y no en cada login para no volver tediosa la sesión; el riesgo se reduce con el límite de intentos del gateway y la recuperación de clave por código. Los profesores pasan por una **lista de espera** que aprueba un **administrador general**, porque si cualquiera pudiera registrarse como profesor un estudiante se daría acceso a los datos de los demás. El envío del correo es **síncrono** (Python → Go): si no sale, el usuario lo sabe en lugar de esperar un código que nunca llega. Si un correo ya tiene un registro a medias **no se pisan sus datos**: solo se reenvía el código (si no, un atacante podría registrar el correo de otra persona con su clave y la víctima verificaría esa cuenta).
10. **Varios profesores y solicitudes de inscripción.** Cada materia tiene un `profesorId` y toda operación del profesor verifica la pertenencia (403 si es de otro), tanto en Java como en Node. Los estudiantes entran a una sección **solo por una solicitud que el profesor aprueba** (entidad `Solicitud`, con clave foránea real a la sección, y copia del nombre, la cédula y el correo tomados del token firmado). Al aprobar, Java recalcula el acceso y avisa a Node, que le asigna las preguntas de las clases ya publicadas. El servicio de usuarios dejó de exponer la lista de usuarios a los profesores: Java entrega los inscritos con sus datos.
11. **Revocación inmediata de sesiones en el gateway.** Antes, desactivar a un usuario no cortaba su sesión hasta que el token vencía (12 h), porque cada servicio solo valida la firma. Ahora Nginx usa `auth_request` y le pregunta a `GET /verificar` de Python, antes de reenviar cada petición, si la cuenta sigue activa. Costo: una consulta a la base por petición y que Python sea punto de paso de todo el tráfico (si cae, los demás servicios quedan inaccesibles desde el navegador); se aceptó por el tamaño del sistema. Alternativas: tokens de 15 minutos con refresh, o una lista de revocados en Redis.
12. **Límite de intentos y rutas internas cerradas.** `limit_req` de 10 por minuto por IP (margen de 5) en ingreso, registro y recuperación, con respuesta 429 en JSON. Las rutas `/interno/*` responden 404 en el gateway: los servicios se hablan por la red de Docker sin pasar por Nginx, así que no hacen falta desde el navegador, y siguen exigiendo el `X-Internal-Token`.
13. **Verificar que el correo es real, sin bloquear al usuario.** Hay tres capas, de la más barata a la más fuerte: (1) formato, con una expresión regular; (2) el DNS del dominio (MX, o A/AAAA si no hay MX, y rechazo del MX nulo del RFC 7505), que atrapa errores como `gmail.con` antes de enviar nada; (3) el código de 6 dígitos, que es la única prueba de que el buzón existe y es de quien se registra. No se usa la verificación SMTP `RCPT TO` porque Gmail y otros proveedores no responden con sinceridad y puede dejar la IP del servidor en listas negras. Si el DNS no responde, el correo se acepta: un fallo de red no debe impedir el registro, y la capa 3 sigue protegiendo. Con Gmail un buzón mal escrito se acepta y rebota después, así que un registro sin verificar **se descarta cuando alguien se registra de nuevo con esa cédula**. Costo: quien conozca la cédula de otra persona puede borrar su registro a medias (ella solo tendría que registrarse otra vez); se aceptó porque una cuenta sin verificar no da acceso a nada y el gateway limita los intentos. Alternativa: limpiar los registros vencidos con una tarea periódica, que deja la cédula bloqueada hasta que corra.
14. **Correo: Mailpit por defecto, proveedor real solo desde el `.env` de cada quien.** El servicio de notificaciones habla SMTP estándar, así que el proveedor es una configuración (cinco variables) y no código. Se evaluaron cuatro caminos: (a) una cuenta de Gmail del proyecto con su contraseña en `.env.example`: se descartó porque el repositorio es público, una clave SMTP publicada permite enviar correo como esa cuenta, queda para siempre en el historial de git, y si Google la bloquea o la revoca el registro deja de funcionar justo cuando se corrige; (b) un servidor de correo propio (Postfix): exige dominio, SPF, DKIM, DNS inverso y el puerto 25 abierto, y aun así los mensajes de una IP doméstica terminan en spam o rechazados; (c) un servicio de correo transaccional con API key: sigue necesitando una clave y, normalmente, un dominio verificado; (d) **Mailpit por defecto** (elegida): no necesita credenciales, funciona en cualquier computadora y deja leer el código en `http://localhost:8025`. Costo: con la configuración por defecto los correos no salen a Internet; quien quiera correo real pone sus datos de Gmail en su `.env`, que está en `.gitignore`, como describe el README.
15. **El gateway como único punto de entrada.** Durante el desarrollo los cuatro microservicios publicaban sus puertos en el host (8001 a 8004) para probar cada uno por separado. Eran puertas que se saltaban el gateway: sin HTTPS, sin la verificación de sesión del punto 11 y sin el límite de intentos del punto 12. Se quitaron del `docker-compose.yml`: ahora los servicios y las bases de datos solo existen en la red interna de Docker, y desde fuera solo se llega a Nginx (443, y el 80 que redirige). No cambia nada más: los servicios se siguen hablando por su nombre (`http://servicio-ia:3000`), los healthchecks corren dentro de cada contenedor y el estado de cada servicio se consulta por el gateway (`/api/<servicio>/health`). Costo: para depurar un servicio aislado hay que entrar a su contenedor (`docker compose exec`) o volver a publicar su puerto solo en local. Mailpit sigue publicando el 8025 porque es la bandeja de prueba para evaluar, no parte de la aplicación.
