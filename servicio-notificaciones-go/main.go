// Microservicio de NOTIFICACIONES — Go + Gin + GORM + PostgreSQL
//
// Gateway: http://localhost/api/notificaciones/...
//   GET   /                    -> notificaciones del usuario del token (+ conteo no leidas)
//   PATCH /:id/leida           -> marcar una como leida
//   POST  /leer-todas          -> marcar todas como leidas
//   POST  /interno/notificar   -> (solo otros microservicios) crea notificacion y envia correo
package main

import (
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// Notificacion es la tabla que GORM crea con AutoMigrate.
type Notificacion struct {
	gorm.Model
	UsuarioID int    `json:"usuarioId" gorm:"index"`
	Titulo    string `json:"titulo"`
	Mensaje   string `json:"mensaje"`
	Enlace    string `json:"enlace"`
	Leida     bool   `json:"leida" gorm:"default:false"`
	CorreoOK  bool   `json:"correoEnviado"`
}

type peticionNotificar struct {
	UsuarioID    int    `json:"usuarioId" binding:"required"`
	Email        string `json:"email"`
	Nombre       string `json:"nombre"`
	Titulo       string `json:"titulo" binding:"required"`
	Mensaje      string `json:"mensaje"`
	Enlace       string `json:"enlace"`
	EnviarCorreo bool   `json:"enviarCorreo"`
}

var db *gorm.DB

func main() {
	godotenv.Load() // en Docker las variables vienen de env_file

	var err error
	for i := 0; i < 10; i++ { // reintentos por si Postgres tarda
		db, err = gorm.Open(postgres.Open(os.Getenv("DATABASE_URL_NOTIF")), &gorm.Config{})
		if err == nil {
			break
		}
		log.Println("esperando Postgres...", err)
		time.Sleep(2 * time.Second)
	}
	if err != nil {
		log.Fatal(err)
	}
	db.AutoMigrate(&Notificacion{})

	r := gin.Default()
	r.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"servicio": "notificaciones", "lenguaje": "Go / Gin", "orm": "GORM",
			"bd": "PostgreSQL", "estado": "ok"})
	})

	r.POST("/interno/notificar", soloInterno, notificar)

	u := r.Group("/", conToken)
	u.GET("/", listar)
	u.PATCH("/:id/leida", marcarLeida)
	u.POST("/leer-todas", leerTodas)

	r.Run(":8080")
}

// ------------------------------------------------------------------ middlewares

// conToken valida el JWT emitido por el servicio de auth (misma SECRET_KEY del .env).
func conToken(c *gin.Context) {
	h := c.GetHeader("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		c.AbortWithStatusJSON(401, gin.H{"detail": "Falta el token"})
		return
	}
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(h[7:], claims, func(t *jwt.Token) (interface{}, error) {
		return []byte(os.Getenv("SECRET_KEY")), nil
	}, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil {
		c.AbortWithStatusJSON(401, gin.H{"detail": "Token invalido"})
		return
	}
	sub, _ := claims["sub"].(string)
	c.Set("uid", sub)
	c.Next()
}

func soloInterno(c *gin.Context) {
	if c.GetHeader("X-Internal-Token") != os.Getenv("INTERNAL_TOKEN") {
		c.AbortWithStatusJSON(403, gin.H{"detail": "Solo servicios internos"})
		return
	}
	c.Next()
}

// ------------------------------------------------------------------ handlers

func listar(c *gin.Context) {
	var lista []Notificacion
	db.Where("usuario_id = ?", c.GetString("uid")).Order("created_at desc").Limit(50).Find(&lista)
	var noLeidas int64
	db.Model(&Notificacion{}).Where("usuario_id = ? AND leida = false", c.GetString("uid")).Count(&noLeidas)
	c.JSON(200, gin.H{"noLeidas": noLeidas, "notificaciones": lista})
}

func marcarLeida(c *gin.Context) {
	res := db.Model(&Notificacion{}).
		Where("id = ? AND usuario_id = ?", c.Param("id"), c.GetString("uid")).
		Update("leida", true)
	if res.RowsAffected == 0 {
		c.JSON(404, gin.H{"detail": "No encontrada"})
		return
	}
	c.Status(http.StatusNoContent)
}

func leerTodas(c *gin.Context) {
	db.Model(&Notificacion{}).Where("usuario_id = ?", c.GetString("uid")).Update("leida", true)
	c.Status(http.StatusNoContent)
}

func notificar(c *gin.Context) {
	var p peticionNotificar
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(400, gin.H{"detail": err.Error()})
		return
	}
	n := Notificacion{UsuarioID: p.UsuarioID, Titulo: p.Titulo, Mensaje: p.Mensaje, Enlace: p.Enlace}
	db.Create(&n)

	// El correo se envia en una goroutine para no bloquear al servicio que llamo.
	if p.EnviarCorreo && p.Email != "" {
		go func(id uint) {
			if err := enviarCorreo(p.Email, p.Nombre, p.Titulo, p.Mensaje, p.Enlace); err != nil {
				log.Println("error enviando correo:", err)
				return
			}
			db.Model(&Notificacion{}).Where("id = ?", id).Update("correo_ok", true)
		}(n.ID)
	}
	c.JSON(201, n)
}
