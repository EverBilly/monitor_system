from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str
    JWT_SECRET: str
    ADMIN_API_KEY: str
    DB_POOL_SIZE: int = 5
    DB_MAX_OVERFLOW: int = 10

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings():
    return Settings()