from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.config import get_settings

settings = get_settings()

def _build_async_url(url: str) -> str:
    """
    Render entrega DATABASE_URL con prefijo 'postgresql://' o 'postgres://'.
    SQLAlchemy + asyncpg necesita 'postgresql+asyncpg://'.
    Esta función normaliza cualquier variante.
    """
    url = url.replace("postgres://", "postgresql://")      # Heroku/Render legacy
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url

async_url = _build_async_url(settings.DATABASE_URL)

engine = create_async_engine(
    async_url,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    echo=False,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()