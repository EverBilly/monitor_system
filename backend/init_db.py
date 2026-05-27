"""
Script de inicialización de base de datos.
Se ejecuta durante el build en Render antes de arrancar la app.
"""
import asyncio, os, sys

async def main():
    import asyncpg

    raw_url = os.environ.get("DATABASE_URL", "")
    if not raw_url:
        print("❌ DATABASE_URL no está definida")
        sys.exit(1)

    # Normalizar URL para asyncpg (requiere postgresql://)
    url = raw_url.replace("postgresql+asyncpg://", "postgresql://") \
                 .replace("postgres://", "postgresql://")

    print(f"🔗 Conectando a la DB...")
    try:
        conn = await asyncpg.connect(url)
    except Exception as e:
        print(f"❌ No se pudo conectar: {e}")
        sys.exit(1)

    print("✅ Conectado. Creando tablas...")

    await conn.execute("""
        CREATE TABLE IF NOT EXISTS tenants (
            id UUID PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
            role TEXT DEFAULT 'user',
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
    await conn.execute("CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)")
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS metrics (
            time TIMESTAMPTZ NOT NULL,
            tenant_id TEXT,
            machine_id TEXT,
            cpu_pct FLOAT,
            ram_pct FLOAT,
            disk JSONB,
            uptime_hours FLOAT,
            security_events TEXT,
            ip INET
        )
    """)

    # TimescaleDB hypertable (opcional)
    try:
        await conn.execute(
            "SELECT create_hypertable('metrics','time',if_not_exists=>TRUE)"
        )
        print("✅ TimescaleDB hypertable configurado")
    except Exception as e:
        print(f"ℹ️  TimescaleDB no disponible: {e}")

    await conn.close()
    print("✅ Tablas listas")

asyncio.run(main())