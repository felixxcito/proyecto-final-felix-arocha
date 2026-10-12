FROM postgres:15-alpine
# Los scripts de esta carpeta se ejecutan al crear el volumen por primera vez
COPY init.sql /docker-entrypoint-initdb.d/init.sql
