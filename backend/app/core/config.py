from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_MINUTES: int = 15
    REFRESH_TOKEN_DAYS: int = 14
    RESET_TOKEN_MINUTES: int = 30
    PORTAL_LINK_VALIDITY_DAYS: int = 2
    ENV: str = "development"
    # Base URL of the deployed frontend, used to build invite/reset/portal links we hand back
    # to an admin (or, once email is wired up, put in an email) rather than the API host itself.
    FRONTEND_URL: str = "http://localhost:5173"
    # Where uploaded images (fabric photos, item-feedback attachments) are stored on disk.
    # Served back out at /uploads/<filename> via a StaticFiles mount (see app/main.py).
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_MB: int = 8

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
