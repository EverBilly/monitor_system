from fastapi import APIRouter, Depends, HTTPException, Query, Request, Header
from sqlalchemy import text
from app.database import get_db, AsyncSession
from app.schemas import MetricPayload, AlertResponse
from app.security.jwt import get_current_user, decode_token
from app.security.anomaly import check_anomalies
from app.config import get_settings
from datetime import datetime, timedelta, timezone
from typing import Optional, List
import json, secrets

router   = APIRouter()
settings = get_settings()


# =============================================================================
# Auth híbrida: JWT (usuarios) o API Key (agentes)
#
# FIX SEGURIDAD: antes comparaba contra "admin-key-1234567890" hardcodeado.
# Ahora usa settings.ADMIN_API_KEY que viene del env var — nunca del código.
# Comparación con secrets.compare_digest para evitar timing attacks.
# =============================================================================
async def get_tenant_from_request(
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_tenant_id:   Optional[str] = Header(None, alias="X-Tenant-ID"),
) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header requerido")

    token = authorization.removeprefix("Bearer ").strip()

    # Intento 1: JWT válido (usuarios del dashboard)
    try:
        payload = decode_token(token)
        tenant  = payload.get("tenant_id")
        if tenant:
            return tenant
    except Exception:
        pass

    # Intento 2: API Key + X-Tenant-ID (agentes Windows)
    # secrets.compare_digest evita timing attacks en la comparación
    api_key_valid = secrets.compare_digest(token, settings.ADMIN_API_KEY)
    if api_key_valid and x_tenant_id:
        return x_tenant_id

    raise HTTPException(status_code=401, detail="Auth inválida: usa JWT o API Key + X-Tenant-ID")


# =============================================================================
# POST /metrics — recibir métricas de agentes
# =============================================================================
@router.post("/metrics", response_model=List[AlertResponse])
async def ingest_metrics(
    payload: MetricPayload,
    db:      AsyncSession = Depends(get_db),
    tenant:  str          = Depends(get_tenant_from_request),
):
    if payload.tenant_id != tenant:
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    disk_json = json.dumps(payload.disk) if isinstance(payload.disk, list) else payload.disk

    await db.execute(text("""
        INSERT INTO metrics
            (time, machine_id, tenant_id, cpu_pct, ram_pct, disk, uptime_hours, security_events, ip)
        VALUES
            (:time, :machine_id, :tenant, :cpu, :ram, :disk, :uptime, :sec, :ip)
    """), {
        "time":       payload.timestamp,
        "machine_id": payload.machine_id,
        "tenant":     tenant,
        "cpu":        payload.cpu_pct,
        "ram":        payload.ram_pct,
        "disk":       disk_json,
        "uptime":     payload.uptime_hours,
        "sec":        payload.security_events,
        "ip":         payload.ip,
    })
    await db.commit()
    return check_anomalies(payload)


# =============================================================================
# GET /machines
# =============================================================================
@router.get("/machines")
async def list_machines(
    db:     AsyncSession = Depends(get_db),
    tenant: str          = Depends(get_tenant_from_request),
):
    result = await db.execute(text("""
        SELECT DISTINCT machine_id, MAX(time) AS last_seen, ip
        FROM metrics
        WHERE tenant_id = :tenant AND time >= :cutoff
        GROUP BY machine_id, ip
        ORDER BY last_seen DESC
    """), {"tenant": tenant, "cutoff": datetime.now(timezone.utc) - timedelta(minutes=30)})

    machines = []
    for row in result:
        machines.append({
            "machine_id": row.machine_id,
            "last_seen":  row.last_seen.isoformat() if row.last_seen else None,
            "ip":         row.ip,
            "status":     "online"
                          if row.last_seen and
                             (datetime.now(timezone.utc) - row.last_seen).total_seconds() < 300
                          else "offline",
        })
    return machines


# =============================================================================
# GET /metrics/latest
# =============================================================================
@router.get("/metrics/latest")
async def get_latest_metrics(
    machine_id: Optional[str] = Query(None),
    limit:      int           = Query(50, ge=1, le=500),
    db:         AsyncSession  = Depends(get_db),
    tenant:     str           = Depends(get_tenant_from_request),
):
    query  = "SELECT time, machine_id, cpu_pct, ram_pct, disk, uptime_hours, security_events FROM metrics WHERE tenant_id = :tenant"
    params = {"tenant": tenant, "limit": limit}

    if machine_id:
        query += " AND machine_id = :machine_id"
        params["machine_id"] = machine_id

    query += " ORDER BY time DESC LIMIT :limit"

    result  = await db.execute(text(query), params)
    metrics = []
    for row in result:
        disk = row.disk
        if isinstance(disk, str):
            try:   disk = json.loads(disk)
            except Exception: disk = []
        metrics.append({
            "time":            row.time.isoformat() if row.time else None,
            "machine_id":      row.machine_id,
            "cpu_pct":         row.cpu_pct,
            "ram_pct":         row.ram_pct,
            "disk":            disk,
            "uptime_hours":    row.uptime_hours,
            "security_events": row.security_events,
        })
    return list(reversed(metrics))


# =============================================================================
# GET /alerts
# =============================================================================
@router.get("/alerts")
async def get_alerts(
    db:     AsyncSession = Depends(get_db),
    tenant: str          = Depends(get_tenant_from_request),
):
    return []
