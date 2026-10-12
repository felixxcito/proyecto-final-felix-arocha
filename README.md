# Aula Virtual LPR — Proyecto Final LPR07304

**Estudiante:** Félix Arocha · **Profesora:** Ing. María Valentina García · Universidad José Antonio Páez · Octubre 2026

Plataforma web para la materia *Lenguajes de Programación* construida con **4 microservicios** (Python, Node.js, Java y Go), **PostgreSQL**, **MongoDB**, **Docker Compose** y **Nginx como API Gateway**.

## ¿Qué hace el sistema?

- **Login con roles** (profesora / estudiante). Las claves se guardan encriptadas con **bcrypt** y la sesión usa **JWT**.
- La **profesora** organiza su trabajo en **materias y secciones** (ej. *Lenguajes de Programación → Sección 01, Sección 02*), crea las cuentas de sus estudiantes inscribiéndolos en su sección, organiza los temas por semana y **sube su presentación** (PDF o PPTX).
- Cada tema se publica a **todas las secciones de la materia o solo a las que ella elija**; cada estudiante solo ve las clases de su sección.
- La **IA** lee cada diapositiva y escribe una **explicación** para los estudiantes. La profesora puede corregirla antes de publicar.
- Al publicar, la IA genera **preguntas distintas para cada estudiante** (la profesora elige cuántas, de 1 a 20; por defecto 5). Ningún estudiante recibe una pregunta que tenga otro. La profesora puede corregir cualquier pregunta mientras el estudiante no haya entregado.
- **Clases privadas con lista de asistencia:** la profesora marca la clase como "Solo asistentes" y **pasa lista por sección** (pestaña por sección, "Todos presentes" / "Ninguno"). Solo los presentes reciben acceso, sus preguntas y una notificación. Puede ir agregando estudiantes mientras da la clase.
- **Visor de diapositivas:** el estudiante ve la diapositiva real junto a la explicación de la IA y avanza con ← →. Los PPTX se convierten a PDF en el servidor con LibreOffice.
- **"Pregúntale a la IA":** un botón pequeño abajo a la derecha abre un chat que conoce la diapositiva que el estudiante está viendo.
- La profesora puede **editar la explicación de la IA** directamente en el visor (botón *Editar*) o en la pestaña *Editar explicaciones*.
- La profesora ve en **"Dudas a la IA"** qué preguntó cada alumno, en qué diapositiva y qué le respondió la IA, además de las diapositivas con más dudas.
- Los estudiantes estudian la clase, **responden** y entregan. La profesora ve todas las respuestas.
- **Notificaciones** con campanita en la web y **por correo** (clase nueva, preguntas asignadas, respuestas entregadas, bienvenida).
- La página **"Cómo lo construimos"** (`http://localhost/como-lo-hicimos.html`) explica cada requisito de la Clase 12 con el código real y muestra el estado de los servicios en vivo.

## Arquitectura

> Por qué elegimos esta arquitectura y cómo fue evolucionando: [docs/arquitectura.md](docs/arquitectura.md)

```
                         ┌──────────────────────────┐
                         │   Navegador (Frontend)   │
                         └────────────┬─────────────┘
                                      │ http://localhost
                         ┌────────────▼─────────────┐
                         │  Nginx — API Gateway :80 │  sirve frontend/ y enruta /api/*
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
| `servicio-auth` | Python 3.12 · FastAPI | 8001 → 8000 | PostgreSQL `auth_db` · SQLAlchemy | `POST /api/auth/login`, `GET /api/auth/me`, `GET/POST/PATCH/DELETE /api/auth/usuarios` |
| `servicio-ia` | Node.js 20 · Express | 8002 → 3000 | MongoDB `aula_ia` · Mongoose | `GET/PUT /api/ia/clases/:id/contenido`, `GET/POST /api/ia/clases/:id/consultas`, `GET/PUT /api/ia/clases/:id/mis-preguntas`, `GET /api/ia/clases/:id/respuestas` |
| `servicio-clases` | Java 21 · Spring Boot 3 | 8003 → 8080 | PostgreSQL `clases_db` · Spring Data JPA | `GET/POST/PUT/DELETE /api/clases/materias`, `POST /api/clases/materias/:id/secciones`, `PUT /api/clases/secciones/:id/estudiantes`, `GET/POST/PUT/DELETE /api/clases/temas`, `POST /api/clases/temas/:id/presentacion`, `POST /api/clases/temas/:id/publicar`, `PUT /api/clases/temas/:id/configuracion`, `GET /api/clases/temas/:id/diapositivas.pdf` |
| `servicio-notificaciones` | Go 1.25 · Gin | 8004 → 8080 | PostgreSQL `notif_db` · GORM | `GET /api/notificaciones/`, `PATCH /api/notificaciones/:id/leida`, `POST /api/notificaciones/leer-todas` |
| `gateway` | Nginx | **80** → 80 | — | Frontend + `/api/*` |
| `mailpit` | — | 8025 → 8025 | — | Bandeja de correos de prueba |

Todos exponen `GET /health`.

### Comunicación entre microservicios

Las llamadas internas usan el nombre del servicio como host (`http://servicio-ia:3000`) y el header `X-Internal-Token`:

| Origen → Destino | Para qué |
|---|---|
| Java → Node | `POST /interno/procesar`: envía la presentación subida para que la IA la explique |
| Node → Java | `PATCH /interno/temas/:id/estado`: avisa que terminó (BORRADOR) o falló (ERROR) |
| Java → Node | `POST /interno/asignar`: al publicar, generar las 5 preguntas por estudiante |
| Node → Python | `GET /usuarios?rol=estudiante`: saber a quién asignar preguntas o a qué profesora avisar |
| Node → Go | `POST /interno/notificar`: campanita + correo a cada estudiante / a la profesora |
| Python → Java | `POST /interno/inscribir`: inscribir al estudiante recién creado en su sección (Java → Node le asigna las preguntas de las clases ya publicadas) |
| Python → Java | `DELETE /interno/estudiantes/:id`: sacar de sus secciones a un estudiante eliminado |
| Java → Node | `POST /interno/asignar` también cada vez que cambian las secciones o la lista: Java calcula quién tiene acceso (`permitidos`) |
| Python → Go | `POST /interno/notificar`: correo de bienvenida |

Además los 4 servicios validan el mismo **JWT** firmado con `SECRET_KEY`.

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
| Plataforma | http://localhost |
| Cómo lo construimos + estado en vivo | http://localhost/como-lo-hicimos.html |
| Bandeja de correos (Mailpit) | http://localhost:8025 |

**Usuario profesora:** el que esté en `ADMIN_EMAIL` / `ADMIN_PASSWORD` del `.env` (por defecto `profesora@ujap.edu.ve` / `Profe2026!`).

> Si el puerto 80 está ocupado en su computadora, cambie `"80:80"` por `"8080:80"` en el servicio `gateway` del `docker-compose.yml` y entre a http://localhost:8080 (ajuste también `PUBLIC_URL`).

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

Por defecto los correos van a **Mailpit** (http://localhost:8025), así se pueden ver sin configurar nada. Para enviar correos reales con Gmail:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=sucorreo@gmail.com
SMTP_PASS=<contraseña de aplicación de Google>
SMTP_FROM=Aula Virtual LPR <sucorreo@gmail.com>
```

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

Las capturas del sistema funcionando están en `docs/`.
