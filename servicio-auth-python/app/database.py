"""Conexion a PostgreSQL con SQLAlchemy (ORM de Python visto en la Clase 12)."""
import os

from dotenv import load_dotenv
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, create_engine, func
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()  # en Docker las variables ya vienen de env_file: .env

DATABASE_URL = os.getenv("DATABASE_URL_AUTH")

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()


class Usuario(Base):
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True)
    nombre = Column(String(120), nullable=False)
    email = Column(String(160), unique=True, nullable=False, index=True)
    # Nunca guardamos la clave: solo su hash bcrypt (incluye sal aleatoria)
    password_hash = Column(String(100), nullable=False)
    rol = Column(String(20), nullable=False, default="estudiante")  # admin | profesor | estudiante
    # Cedula de identidad (V-12345678). Unica; el admin no tiene, por eso admite NULL.
    cedula = Column(String(20), unique=True, nullable=True)
    email_verificado = Column(Boolean, nullable=False, default=False)
    # sin_verificar -> (en_espera, solo profesores) -> activo | rechazado | desactivado
    estado = Column(String(20), nullable=False, default="sin_verificar")
    creado_en = Column(DateTime(timezone=True), server_default=func.now())

    @property
    def activo(self) -> bool:
        """Solo una cuenta en estado 'activo' puede entrar al sistema."""
        return self.estado == "activo"


class ClaveAnterior(Base):
    """Hash bcrypt de una clave que el usuario ya tuvo. Sirve para no dejarlo repetir una clave vieja."""
    __tablename__ = "claves_anteriores"

    id = Column(Integer, primary_key=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    password_hash = Column(String(100), nullable=False)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())


class Codigo(Base):
    """Codigo de 6 digitos enviado por correo (para verificar la cuenta o recuperar la clave)."""
    __tablename__ = "codigos"

    id = Column(Integer, primary_key=True)
    # Clave foranea real: aqui si, ambas tablas estan en la misma base (auth_db)
    usuario_id = Column(Integer, ForeignKey("usuarios.id", ondelete="CASCADE"), nullable=False, index=True)
    proposito = Column(String(20), nullable=False)          # verificar | recuperar
    codigo_hash = Column(String(64), nullable=False)        # sha256: el codigo en claro nunca se guarda
    expira_en = Column(DateTime(timezone=True), nullable=False)
    intentos = Column(Integer, nullable=False, default=0)   # intentos fallidos (maximo 5)
    usado = Column(Boolean, nullable=False, default=False)
    creado_en = Column(DateTime(timezone=True), server_default=func.now())


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
