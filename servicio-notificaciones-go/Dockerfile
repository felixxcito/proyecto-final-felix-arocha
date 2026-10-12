# ---- Etapa 1: compilar
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
# go mod tidy descarga dependencias y genera go.sum
RUN go mod tidy && CGO_ENABLED=0 go build -o /notificaciones .

# ---- Etapa 2: imagen final liviana (~20 MB)
FROM alpine:3.20
COPY --from=build /notificaciones /notificaciones
EXPOSE 8080
CMD ["/notificaciones"]
