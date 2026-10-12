# Gateway: Nginx con la configuracion y el frontend dentro de la imagen
FROM nginx:1.27-alpine
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY frontend/ /usr/share/nginx/html/
