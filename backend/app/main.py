from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from app.routers import metrics, auth
from app.database import engine, get_db, AsyncSession
from app.security.jwt import require_tenant_match, get_password_hash, get_current_user
from sqlalchemy import text
import logging, os, uuid

logger      = logging.getLogger(__name__)
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
DEV_EMAIL    = "dev@monitor.dev"
DEV_PASSWORD = "DevPass123!"

limiter = Limiter(key_func=get_remote_address)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        # ── 1. TimescaleDB (opcional — falla silenciosamente en Render free) ──
        has_timescale = False
        try:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS timescaledb;"))
            has_timescale = True
            logger.info("✅ TimescaleDB disponible")
        except Exception:
            logger.warning("⚠️  TimescaleDB no disponible — usando PostgreSQL estándar")

        # ── 2. Tablas — SIEMPRE se crean, independiente de TimescaleDB ────────
        try:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS tenants (
                    id UUID PRIMARY KEY, name TEXT UNIQUE NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );"""))
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS users (
                    id UUID PRIMARY KEY, email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
                    role TEXT DEFAULT 'user', created_at TIMESTAMPTZ DEFAULT NOW()
                );"""))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);"))
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS metrics (
                    time TIMESTAMPTZ NOT NULL, tenant_id TEXT, machine_id TEXT,
                    cpu_pct FLOAT, ram_pct FLOAT, disk JSONB, uptime_hours FLOAT,
                    security_events TEXT, ip INET
                );"""))
            logger.info("✅ Tables ready")
        except Exception as e:
            logger.error(f"❌ Error creating tables: {e}")
            raise  # Re-raise — sin tablas la app no puede funcionar

        # ── 3. TimescaleDB hypertable (solo si está disponible) ───────────────
        if has_timescale:
            try:
                await conn.execute(text(
                    "SELECT create_hypertable('metrics','time',if_not_exists=>TRUE);"))
                logger.info("✅ TimescaleDB hypertable ready")
            except Exception as e:
                logger.warning(f"⚠️  Hypertable skipped: {e}")

            # Compresión — requiere licencia paga, falla silenciosamente en free tier
            try:
                await conn.execute(text("""
                    ALTER TABLE metrics SET (
                        timescaledb.compress,
                        timescaledb.compress_orderby = 'time DESC',
                        timescaledb.compress_segmentby = 'machine_id'
                    );"""))
                await conn.execute(text(
                    "SELECT add_compression_policy('metrics',INTERVAL '7 days',if_not_exists=>TRUE);"))
                logger.info("✅ TimescaleDB compression enabled")
            except Exception:
                logger.info("ℹ️  TimescaleDB compression not available (free tier) — OK")

        # ── 4. Sembrar usuario dev (solo fuera de producción) ─────────────────
        if ENVIRONMENT != "production":
            try:
                row = (await conn.execute(
                    text("SELECT id FROM users WHERE email = :e"), {"e": DEV_EMAIL}
                )).fetchone()
                if not row:
                    tid, uid = str(uuid.uuid4()), str(uuid.uuid4())
                    await conn.execute(
                        text("INSERT INTO tenants (id, name) VALUES (:id,'DevTenant')"), {"id": tid})
                    await conn.execute(
                        text("""INSERT INTO users (id,email,password_hash,tenant_id,role)
                                VALUES (:id,:e,:ph,:tid,'admin')"""),
                        {"id": uid, "e": DEV_EMAIL,
                         "ph": get_password_hash(DEV_PASSWORD), "tid": tid})
                    logger.info(f"✅ Dev user created: {DEV_EMAIL}")
                else:
                    logger.info(f"✅ Dev user ready: {DEV_EMAIL}")
            except Exception as e:
                logger.warning(f"⚠️  Dev user seed failed: {e}")
    yield


app = FastAPI(title="Monitor System API", version="1.0.0", lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "https://tudominio.com"],
    allow_origin_regex=r"https://(.*\.pages\.dev|.*\.tudominio\.com)",
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"]  = "nosniff"
    response.headers["X-Frame-Options"]          = "DENY"
    response.headers["Referrer-Policy"]          = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"]       = "geolocation=(), microphone=(), camera=()"
    if ENVIRONMENT == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])

if ENVIRONMENT == "production":
    app.include_router(metrics.router, prefix="/api/v1",
                       dependencies=[Depends(require_tenant_match)], tags=["metrics"])
else:
    app.include_router(metrics.router, prefix="/api/v1", tags=["metrics"])

@app.get("/health", tags=["system"])
async def health():
    return {"status": "ok", "environment": ENVIRONMENT}

@app.get("/", tags=["system"])
async def root():
    return {"message": "Monitor System API", "docs": "/docs"}

# Debug — requiere JWT, solo fuera de producción
@app.get("/api/v1/debug/status", tags=["debug"])
async def debug_status(current_user: dict = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    if ENVIRONMENT == "production":
        raise HTTPException(status_code=404)
    try:
        total    = (await db.execute(text("SELECT COUNT(*) FROM metrics"))).scalar() or 0
        tenants  = (await db.execute(text("SELECT id, name FROM tenants ORDER BY name"))).fetchall()
        machines = (await db.execute(text("""
            SELECT machine_id, tenant_id, COUNT(*) AS n, MAX(time) AS last_seen,
                   AVG(cpu_pct) AS cpu, AVG(ram_pct) AS ram
            FROM metrics GROUP BY machine_id, tenant_id ORDER BY last_seen DESC
        """))).fetchall()
        recent   = (await db.execute(text("""
            SELECT time, machine_id, tenant_id, cpu_pct, ram_pct
            FROM metrics ORDER BY time DESC LIMIT 10
        """))).fetchall()
        return {
            "metrics_total": total,
            "tenants":  [{"id": str(r.id), "name": r.name} for r in tenants],
            "machines": [{"machine_id": r.machine_id, "tenant_id": str(r.tenant_id),
                          "count": r.n, "avg_cpu": round(r.cpu or 0, 1),
                          "avg_ram": round(r.ram or 0, 1),
                          "last_seen": r.last_seen.isoformat() if r.last_seen else None}
                         for r in machines],
            "recent":   [{"time": r.time.isoformat(), "machine_id": r.machine_id,
                          "tenant_id": str(r.tenant_id),
                          "cpu_pct": round(r.cpu_pct or 0, 1), "ram_pct": round(r.ram_pct or 0, 1)}
                         for r in recent],
            "dev_hint": f"Login: {DEV_EMAIL}",
        }
    except Exception as e:
        return {"error": str(e)}