"""Conexion a PostgreSQL con SQLAlchemy (ORM de Python visto en la Clase 12)."""
import os

from dotenv import load_dotenv
from sqlalchemy import Boolean, Column, DateTime, Integer, String, create_engine, func
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
    rol = Column(String(20), nullable=False, default="estudiante")  # admin | profesora | estudiante
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


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
