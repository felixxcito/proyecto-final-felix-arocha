package main

import (
	"fmt"
	"html"
	"mime"
	"net/smtp"
	"os"
	"strings"
)

// enviarCorreo manda un correo HTML usando el SMTP configurado en el .env
// (por defecto Mailpit, que no pide usuario ni clave).
func enviarCorreo(para, nombre, titulo, mensaje, enlace string) error {
	host := os.Getenv("SMTP_HOST")
	puerto := os.Getenv("SMTP_PORT")
	from := os.Getenv("SMTP_FROM")
	if host == "" {
		return fmt.Errorf("SMTP_HOST no configurado")
	}

	var auth smtp.Auth
	if user := os.Getenv("SMTP_USER"); user != "" {
		auth = smtp.PlainAuth("", user, os.Getenv("SMTP_PASS"), host)
	}

	boton := ""
	if enlace != "" {
		boton = fmt.Sprintf(`<p><a href="%s" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Abrir Aula Virtual</a></p>`, html.EscapeString(enlace))
	}
	cuerpo := fmt.Sprintf(`<div style="font-family:Arial,sans-serif;max-width:520px">
<h2 style="color:#1d4ed8">%s</h2><p>Hola %s,</p><p>%s</p>%s
<p style="color:#888;font-size:12px">Aula Virtual LPR · Universidad José Antonio Páez</p></div>`,
		html.EscapeString(titulo), html.EscapeString(nombre), html.EscapeString(mensaje), boton)

	encabezados := []string{
		"From: " + from,
		"To: " + para,
		"Subject: " + mime.QEncoding.Encode("utf-8", titulo),
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=UTF-8",
	}
	msg := strings.Join(encabezados, "\r\n") + "\r\n\r\n" + cuerpo

	// Direccion del remitente sin el nombre: "Aula <a@b.c>" -> "a@b.c"
	remitente := from
	if i := strings.Index(from, "<"); i >= 0 {
		remitente = strings.Trim(from[i:], "<> ")
	}
	return smtp.SendMail(host+":"+puerto, auth, remitente, []string{para}, []byte(msg))
}
