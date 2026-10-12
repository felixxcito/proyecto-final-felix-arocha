# Gateway: Nginx con HTTPS, la configuracion y el frontend dentro de la imagen
FROM nginx:1.27-alpine

# Certificado autofirmado para localhost, generado al construir la imagen.
# El navegador pedira aceptarlo la primera vez (en produccion seria un certificado real, p. ej. Let's Encrypt).
RUN apk add --no-cache openssl \
 && mkdir -p /etc/nginx/certs \
 && openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout /etc/nginx/certs/localhost.key -out /etc/nginx/certs/localhost.crt \
      -subj "/CN=localhost/O=Aula Virtual LPR" \
      -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1" \
 && apk del openssl

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY frontend/ /usr/share/nginx/html/
