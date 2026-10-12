-- Se ejecuta solo la primera vez que se crea el volumen de Postgres.
-- Una base de datos por microservicio: cada servicio es dueño de sus datos.
CREATE DATABASE auth_db;
CREATE DATABASE clases_db;
CREATE DATABASE notif_db;
