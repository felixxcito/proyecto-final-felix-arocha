# Aula Virtual LPR — Proyecto Final LPR07304

**Estudiante:** Félix Arocha · **Profesora:** Ing. María Valentina García · Universidad José Antonio Páez · Octubre 2026

Plataforma web para la materia *Lenguajes de Programación* construida con **4 microservicios** (Python, Node.js, Java y Go), **PostgreSQL**, **MongoDB**, **Docker Compose** y **Nginx como API Gateway**.

## ¿Qué hace el sistema?

Una plataforma de clases con tres tipos de cuenta, como una web normal:

- **Cualquiera se registra** como **estudiante** o **profesor** con nombre, **cédula**, correo y clave, y **confirma su correo con un código de 6 dígitos** que le llega de verdad (vence en 10 minutos, máximo 5 intentos). También hay **"¿Olvidaste tu clave?"** (otro código al correo) y la casilla **"Recordarme"** (sesión de 30 días).
- Los **profesores** quedan en una **lista de espera** hasta que el **administrador general** los aprueba (recibe un aviso y los aprueba o rechaza desde su panel; al profesor le llega un correo con la decisión).
- Cada **profesor** crea **sus propias materias, secciones y horarios**. Solo él ve y modifica lo suyo.
- El **estudiante** abre **"Inscribirme"**: el catálogo muestra los profesores con sus materias y las secciones con su horario, y **solicita inscripción**. El profesor ve en su inicio las **solicitudes pendientes** con el **nombre, la cédula y el correo** del estudiante y las **aprueba o rechaza**; el estudiante recibe la respuesta (campanita y correo).
- El profesor organiza los temas por semana y **sube su presentación** (PDF o PPTX). Cada tema se publica a **todas las secciones de la materia o solo a las que elija**; el estudiante solo ve las clases de las secciones donde fue aprobado.
- La **IA** lee cada diapositiva y escribe una **explicación**. El profesor puede corregirla antes de publicar (en el visor con el botón *Editar* o en la pestaña *Editar explicaciones*).
- Al publicar, la IA genera **preguntas distintas para cada estudiante** (el profesor elige cuántas, de 1 a 20; por defecto 5). Ningún estudiante recibe una pregunta que tenga otro. El profesor puede corregir cualquier pregunta mientras el estudiante no haya entregado.
- **Clases privadas con lista de asistencia:** el profesor marca la clase como "Solo asistentes" y **pasa lista por sección** (con nombre, cédula y correo de cada alumno). Solo los presentes reciben acceso, sus preguntas y una notificación.
- **Visor de diapositivas:** el estudiante ve la diapositiva real junto a la explicación de la IA y avanza con ← →. Los PPTX se convierten a PDF en el servidor con LibreOffice.
- **"Pregúntale a la IA":** un botón pequeño abajo a la derecha abre un chat que conoce la diapositiva que el estudiante está viendo. El profesor ve en **"Dudas a la IA"** qué preguntó cada alumno, en qué diapositiva y qué le respondió la IA.
- Los estudiantes **responden** y entregan; el profesor de esa clase ve todas las respuestas y recibe el aviso.
- **Notificaciones** con campanita en la web y **por correo** (códigos, solicitudes, aprobaciones, clase nueva, preguntas asignadas, entregas).
- El **administrador general** también puede activar o desactivar cuentas: una cuenta desactivada **pierde el acceso al instante** en los 4 servicios.
- La página **"Cómo lo construimos"** (`https://localhost/como-lo-hicimos.html`) explica cada requisito de la Clase 12 con el código real y muestra el estado de los servicios en vivo.

## Arquitectura

> Por qué elegimos esta arquitectura y cómo fue evolucionando: [docs/arquitectura.md](docs/arquitectura.md)

```
                         ┌──────────────────────────┐
                         │   Navegador (Frontend)   │
                         └────────────┬─────────────┘
                                      │ https://localhost
                         ┌────────────▼─────────────┐
                         │ Nginx — API Gateway :443 │  HTTPS; sirve frontend/ y enruta /api/*
                         └──┬────────┬────────┬─────┘
          /api/auth/        │        │        │        /api/notificaciones/
        ┌───────────────────┘   /api/ia/  /api/clases/ └──────────────────┐
        │                            │        │                           │
┌───────▼────────┐  ┌────────────────▼─┐  ┌───▼──────────────┐  ┌─────────▼────────┐
│ auth · Python  │◄─┤  ia · Node.js    │◄─┤ clases · Java    │  │ notificaciones   │
│ FastAPI        │  │  Express         │─►│ Spring Boot      │  │ · Go (Gin)       │
│ SQLAlchemy     │─►│  Mongoose        │  │ Spring Data JPA  │  │ GORM + SMTP      │
└───────┬────────┘  └──────┬─────┬─────┘  └────────┬─────────┘  └─────▲───┬────────┘
        │                  │     └── notificar ────┼─────────────────►│   │
        │                  │                       │                  │   │ correo
┌───────▼──────────────────┼───────────────────────▼──────────────────┴┐  ▼
│ PostgreSQL 15:  auth_db · clases_db · notif_db                       │ Mailpit
└──────────────────────────┼───────────────────────────────────────────┘ :8025
                    ┌──────▼──────┐          ┌─────────────────────────┐
                    │ MongoDB 7   │          │ IA externa: NVIDIA NIM  │
                    └─────────────┘          │ o Google Gemini         │
                                             └─────────────────────────┘
```

Redes de Docker: `backend` (bases de datos, Mailpit y servicios) y `frontend` (gateway y servicios). El gateway **no** tiene acceso a las bases de datos.

## Microservicios

| Servicio | Lenguaje | Puerto (host → contenedor) | Base de datos / ORM | Endpoints principales (vía gateway) |
|---|---|---|---|---|
| `servicio-auth` | Python 3.12 · FastAPI | 8001 → 8000 | PostgreSQL `auth_db` · SQLAlchemy | `POST /api/auth/registro`, `/registro/verificar`, `/registro/reenviar`, `POST /api/auth/login`, `/recuperar`, `/recuperar/confirmar`, `GET /api/auth/me`, `GET /api/auth/admin/profesores`, `POST …/admin/profesores/:id/aprobar\|rechazar`, `GET/PATCH/DELETE /api/auth/admin/usuarios` |
| `servicio-ia` | Node.js 20 · Express | 8002 → 3000 | MongoDB `aula_ia` · Mongoose | `GET/PUT /api/ia/clases/:id/contenido`, `GET/POST /api/ia/clases/:id/consultas`, `GET/PUT /api/ia/clases/:id/mis-preguntas`, `GET /api/ia/clases/:id/respuestas` |
| `servicio-clases` | Java 21 · Spring Boot 3 | 8003 → 8080 | PostgreSQL `clases_db` · Spring Data JPA | `GET/POST/PUT/DELETE /api/clases/materias`, `POST /api/clases/materias/:id/secciones`, `DELETE /api/clases/secciones/:id/estudiantes/:eid`, `GET /api/clases/catalogo`, `POST/GET /api/clases/solicitudes`, `PUT /api/clases/solicitudes/:id`, `GET/POST/PUT/DELETE /api/clases/temas`, `POST /api/clases/temas/:id/presentacion`, `POST /api/clases/temas/:id/publicar`, `PUT /api/clases/temas/:id/configuracion`, `GET /api/clases/temas/:id/diapositivas.pdf` |
| `servicio-notificaciones` | Go 1.25 · Gin | 8004 → 8080 | PostgreSQL `notif_db` · GORM | `GET /api/notificaciones/`, `PATCH /api/notificaciones/:id/leida`, `POST /api/notificaciones/leer-todas` |
| `gateway` | Nginx | **443** → 443 (el 80 redirige a HTTPS) | — | Frontend + `/api/*` |
| `mailpit` | — | 8025 → 8025 | — | Bandeja de correos de prueba |

Todos exponen `GET /health`.

### Comunicación entre microservicios

Las llamadas internas usan el nombre del servicio como host (`http://servicio-ia:3000`) y el header `X-Internal-Token`:

| Origen → Destino | Para qué |
|---|---|
| Java → Node | `POST /interno/procesar`: envía la presentación subida para que la IA la explique |
| Node → Java | `PATCH /interno/temas/:id/estado`: avisa que terminó (BORRADOR) o falló (ERROR) |
| Java → Node | `POST /interno/asignar`: al publicar, generar las 5 preguntas por estudiante |
| Node → Python | `GET /usuarios?rol=…`: nombre y correo de los estudiantes con acceso o del profesor dueño (ruta solo interna) |
| Node → Go | `POST /interno/notificar`: campanita + correo a cada estudiante / al profesor dueño de la clase |
| Python → Java | `DELETE /interno/estudiantes/:id`: sacar de sus secciones a un estudiante eliminado |
| Java → Node | `POST /interno/asignar` cada vez que cambian las secciones, la lista o se aprueba a un estudiante: Java calcula quién tiene acceso (`permitidos`) y el profesor dueño |
| Python → Go | `POST /interno/correo`: **código de verificación** y de recuperación de clave (síncrono: si el correo no sale, el usuario lo sabe) |
| Python → Go | `POST /interno/notificar`: avisar a los admins de un profesor nuevo y al profesor de la decisión |
| Java → Go | `POST /interno/notificar`: avisar al profesor de una solicitud y al estudiante de su respuesta |

Además los 4 servicios validan el mismo **JWT** firmado con `SECRET_KEY`, y **Nginx le pregunta a Python en cada petición** si la cuenta del token sigue activa (`auth_request`): un usuario desactivado o eliminado recibe 401 al instante en todos los servicios. Las rutas `/interno/*` están **cerradas en el gateway** (404 desde el navegador).

## Cómo ejecutarlo

Requisitos: Docker Desktop (o Docker Engine + Compose v2).

```bash
git clone <URL-del-repositorio>
cd proyecto-final-felix-arocha
cp .env.example .env
docker compose up --build
```

La primera vez tarda unos minutos (Maven descarga dependencias de Java). Cuando todo esté *healthy*:

| Qué | URL |
|---|---|
| Plataforma | https://localhost |
| Cómo lo construimos + estado en vivo | https://localhost/como-lo-hicimos.html |
| Bandeja de correos (Mailpit) | http://localhost:8025 |

**Administrador general:** el que esté en `ADMIN_EMAIL` / `ADMIN_PASSWORD` del `.env` (por defecto `admin@ujap.edu.ve` / `Admin2026!`). Es la única cuenta que existe al empezar: los profesores y estudiantes se **registran solos** desde la pantalla de ingreso. Los códigos de verificación llegan al correo (con el SMTP por defecto, a la bandeja de Mailpit).

> **HTTPS y certificado.** El gateway sirve la plataforma por HTTPS (puerto 443) con un certificado **autofirmado** que se genera al construir la imagen, y el puerto 80 redirige a HTTPS. La primera vez el navegador mostrará *"Tu conexión no es privada"*: pulsa **Avanzado → Continuar a localhost** (es normal con certificados locales; en producción se usaría uno real, por ejemplo de Let's Encrypt). Con `curl` usa la opción `-k`.
>
> Si el puerto 80 o el 443 están ocupados en su computadora, cambie `"80:80", "443:443"` por `"8080:80", "8443:443"` en el servicio `gateway` del `docker-compose.yml` y entre a https://localhost:8443 (ajuste también `PUBLIC_URL`).

## Configuración (`.env`)

El repositorio solo incluye `.env.example`; el `.env` real está en `.gitignore`.

### Inteligencia Artificial

El sistema funciona **sin API key** en *modo demo* (explicaciones y preguntas generadas por plantillas). Para usar IA real:

**Opción A — NVIDIA NIM (gratis, por defecto)**
1. Entrar a https://build.nvidia.com e iniciar sesión.
2. Abrir cualquier modelo (p. ej. *gemma-4-31b-it*) → **Get API Key**. La key empieza con `nvapi-`.
3. En el `.env`:
   ```
   IA_PROVIDER=nvidia
   NVIDIA_API_KEY=nvapi-xxxxxxxx
   NVIDIA_MODEL=google/gemma-4-31b-it
   ```

**Opción B — Google Gemini**
1. Crear una key en https://aistudio.google.com/apikey
2. En el `.env`:
   ```
   IA_PROVIDER=gemini
   GEMINI_API_KEY=AIza...
   ```

Después de cambiar el `.env`: `docker compose up -d` (recrea los servicios con la nueva configuración). Si una clase se procesó en modo demo, use **"Regenerar con IA"** en la clase.

### Correo

El sistema **envía correos de verdad** (códigos de verificación, recuperación de clave, solicitudes y avisos). Por defecto los manda a **Mailpit** (http://localhost:8025), una bandeja de prueba: así se puede evaluar todo sin configurar nada, leyendo el código ahí.

Para que lleguen a bandejas reales (por ejemplo Gmail):

1. En tu cuenta de Google activa la **verificación en 2 pasos** y crea una **contraseña de aplicación** (Cuenta de Google → Seguridad → Contraseñas de aplicaciones).
2. Edita el `.env` (con el puerto **587**; el 465 no funciona con este servicio):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=sucorreo@gmail.com
SMTP_PASS=<contraseña de aplicación de 16 letras>
SMTP_FROM=Aula Virtual LPR <sucorreo@gmail.com>
```

3. `docker compose up -d` (recrea los servicios con la nueva configuración).

Si el correo no se puede enviar, el registro responde con un error claro (no deja una cuenta imposible de verificar).

### Seguridad

Cambie `SECRET_KEY` (mínimo 32 caracteres), `INTERNAL_TOKEN`, `DB_PASS` y `ADMIN_PASSWORD`. Si cambia `DB_USER`/`DB_PASS` actualice también las tres `DATABASE_URL_*`.

> Las bases de datos se crean la primera vez que se crea el volumen. Para empezar de cero: `docker compose down -v`.

## Recorrido sugerido para evaluar

1. Entrar como profesora → **Secciones**: ya existe *Lenguajes de Programación · Sección 01*; crear una *Sección 02*.
2. **Usuarios** → crear 2 estudiantes eligiendo su sección (botón *Generar* para la clave).
3. **Clases** → *Semana 12* (o *+ Nuevo tema*) → arrastrar la presentación (PDF o PPTX).
3. Esperar a que la IA termine (la página se actualiza sola) → revisar/corregir las explicaciones → elegir cuántas preguntas por estudiante → **Publicar**.
   - Opcional: marcar **🔒 Solo asistentes** y **Pasar lista** para que solo los presentes vean la clase.
4. Ver en http://localhost:8025 los correos enviados.
5. Cerrar sesión, entrar como estudiante → abrir la clase → **Ver clase**: recorrer las diapositivas y usar **Pregúntale a la IA**.
6. **Mis 5 preguntas** → responder y entregar.
7. Entrar con el otro estudiante: sus 5 preguntas son distintas.
8. Volver como profesora: campanita con la entrega, pestañas **Respuestas de estudiantes** y **Dudas a la IA**.

## Estructura del repositorio

```
proyecto-final-felix-arocha/
├── .env.example              variables de entorno (copiar a .env)
├── docker-compose.yml        orquesta los 8 contenedores
├── nginx/nginx.conf          API Gateway
├── postgres/init.sql         crea una BD por microservicio
├── frontend/                 HTML/CSS/JS (login, plataforma, "cómo lo construimos")
├── servicio-auth-python/     FastAPI + SQLAlchemy + bcrypt + JWT
├── servicio-ia-node/         Express + Mongoose + NVIDIA/Gemini
├── servicio-clases-java/     Spring Boot + Spring Data JPA + LibreOffice (PPTX → PDF)
└── servicio-notificaciones-go/  Gin + GORM + SMTP
```

## Temas de la materia

Los temas iniciales se cargan desde `servicio-clases-java/src/main/resources/temas-semilla.json` la primera vez que arranca el servicio. La profesora puede agregar, editar o eliminar temas desde la plataforma.

## Capturas

### Frontend

| Login | Clases de la profesora |
|---|---|
| ![Login](docs/capturas/01-login.png) | ![Clases de la profesora](docs/capturas/02-clases-profesora.png) |

| Visor de diapositivas con la explicación de la IA | Chat "Pregúntale a la IA" |
|---|---|
| ![Visor de diapositivas](docs/capturas/03-visor.png) | ![Chat con la IA](docs/capturas/04-chat-ia.png) |

| Materias y secciones | Pasar lista por sección |
|---|---|
| ![Materias y secciones](docs/capturas/05-secciones.png) | ![Pasar lista](docs/capturas/06-pasar-lista.png) |

| Preguntas del estudiante | Dudas a la IA (vista de la profesora) |
|---|---|
| ![Preguntas del estudiante](docs/capturas/07-preguntas-estudiante.png) | ![Dudas a la IA](docs/capturas/08-dudas-ia.png) |

| Notificaciones (campanita) | Correos en Mailpit |
|---|---|
| ![Notificaciones](docs/capturas/09-notificaciones.png) | ![Correos en Mailpit](docs/capturas/10-correos-mailpit.png) |

### Servicios respondiendo

Estado de los 4 microservicios consultado en vivo a través del gateway (`/api/<servicio>/health`):

![Estado de los servicios](docs/capturas/11-servicios-en-vivo.png)

Las mismas respuestas desde la terminal:

```bash
curl -k https://localhost/api/auth/health
curl -k https://localhost/api/ia/health
curl -k https://localhost/api/clases/health
curl -k https://localhost/api/notificaciones/health
```

![Respuestas de /health en la terminal](docs/capturas/12-health-terminal.png)

### Contenedores en ejecución

```bash
docker compose ps
```

![docker compose ps](docs/capturas/13-docker-compose-ps.png)
