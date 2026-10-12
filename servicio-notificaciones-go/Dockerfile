# ---- Etapa 1: compilar
FROM golang:1.25-alpine AS build
WORKDIR /src
# Primero solo go.mod/go.sum: Docker cachea las dependencias si no cambian
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -o /notificaciones .

# ---- Etapa 2: imagen final liviana (~20 MB)
FROM alpine:3.20
COPY --from=build /notificaciones /notificaciones
EXPOSE 8080
CMD ["/notificaciones"]
