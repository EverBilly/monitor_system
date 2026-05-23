from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from app.database import get_db, AsyncSession
from app.schemas import UserRegister, UserLogin, AuthResponse, Token, UserResponse
from app.security.jwt import verify_password, get_password_hash, create_access_token, get_current_user
import uuid
import os
from datetime import datetime, timezone

router = APIRouter(tags=["auth"])

# =============================================================================
# POST /register
# =============================================================================
@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register_user(payload: UserRegister, db: AsyncSession = Depends(get_db)):
    """Registro de nuevo usuario + tenant"""

    result = await db.execute(
        text("SELECT id FROM users WHERE email = :email"),
        {"email": payload.email.lower()}
    )
    if result.fetchone():
        raise HTTPException(status_code=400, detail="Este email ya está registrado")

    tenant_id = str(uuid.uuid4())
    await db.execute(
        text("INSERT INTO tenants (id, name, created_at) VALUES (:id, :name, :created_at)"),
        {"id": tenant_id, "name": payload.tenant_name, "created_at": datetime.now(timezone.utc)}
    )

    user_id = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO users (id, email, password_hash, tenant_id, role, created_at)
            VALUES (:id, :email, :password_hash, :tenant_id, :role, :created_at)
        """),
        {
            "id": user_id,
            "email": payload.email.lower(),
            "password_hash": get_password_hash(payload.password),
            "tenant_id": tenant_id,
            "role": "admin",
            "created_at": datetime.now(timezone.utc)
        }
    )
    await db.commit()

    access_token = create_access_token(
        data={"sub": user_id, "tenant_id": tenant_id, "role": "admin"}
    )

    return AuthResponse(
        user=UserResponse(
            id=user_id,
            email=payload.email.lower(),
            tenant_id=tenant_id,
            tenant_name=payload.tenant_name,
            role="admin",
            created_at=datetime.now(timezone.utc)
        ),
        token=Token(access_token=access_token)
    )


# =============================================================================
# POST /login
# =============================================================================
@router.post("/login", response_model=AuthResponse)
async def login_user(payload: UserLogin, db: AsyncSession = Depends(get_db)):
    """Login de usuario existente"""

    result = await db.execute(
        text("""
            SELECT u.id, u.email, u.password_hash, u.tenant_id, u.role, t.name as tenant_name
            FROM users u
            JOIN tenants t ON u.tenant_id = t.id
            WHERE u.email = :email
        """),
        {"email": payload.email.lower()}
    )
    row = result.fetchone()

    if not row or not verify_password(payload.password, row.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Email o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"}
        )

    access_token = create_access_token(
        data={"sub": str(row.id), "tenant_id": str(row.tenant_id), "role": row.role}
    )

    return AuthResponse(
        user=UserResponse(
            id=str(row.id),
            email=row.email,
            tenant_id=str(row.tenant_id),
            tenant_name=row.tenant_name,
            role=row.role,
            created_at=datetime.now(timezone.utc)
        ),
        token=Token(access_token=access_token)
    )


# =============================================================================
# GET /me
# =============================================================================
@router.get("/me", response_model=dict)
async def get_current_user_info(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Obtener información del usuario actual"""
    result = await db.execute(
        text("""
            SELECT u.email, u.role, t.name as tenant_name
            FROM users u
            JOIN tenants t ON u.tenant_id = t.id
            WHERE u.id = :user_id
        """),
        {"user_id": current_user["user_id"]}
    )
    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    return {
        "user_id": current_user["user_id"],
        "email": row.email,
        "role": row.role,
        "tenant_id": current_user["tenant_id"],
        "tenant_name": row.tenant_name
    }


# =============================================================================
# POST /dev-setup  ← NUEVO: resuelve el BUG #1 (tenant mismatch en dev)
#
# Solo disponible cuando ENVIRONMENT != "production".
# Crea (o reutiliza) un usuario de desarrollo con tenant real en la DB.
# El mock_agent llama este endpoint al arrancar para obtener el tenant_id
# UUID real, de modo que los datos que ingesta son visibles en el dashboard.
#
# Credenciales dev: dev@monitor.local / DevPass123!
# =============================================================================
DEV_EMAIL = "dev@monitor.local"
DEV_PASSWORD = "DevPass123!"
DEV_TENANT_NAME = "DevTenant"

@router.post("/dev-setup")
async def dev_setup(db: AsyncSession = Depends(get_db)):
    """
    Crea o reutiliza el usuario de desarrollo y devuelve su tenant_id + JWT.
    El mock_agent usa este endpoint para obtener el tenant_id real al arrancar.
    Solo disponible en entornos no productivos.
    """
    if os.getenv("ENVIRONMENT") == "production":
        raise HTTPException(status_code=404, detail="Not found")

    # ¿Ya existe el usuario dev?
    result = await db.execute(
        text("SELECT u.id, u.tenant_id FROM users u WHERE u.email = :email"),
        {"email": DEV_EMAIL}
    )
    row = result.fetchone()

    if row:
        user_id = str(row.id)
        tenant_id = str(row.tenant_id)
    else:
        # Crear tenant dev
        tenant_id = str(uuid.uuid4())
        await db.execute(
            text("INSERT INTO tenants (id, name, created_at) VALUES (:id, :name, :now)"),
            {"id": tenant_id, "name": DEV_TENANT_NAME, "now": datetime.now(timezone.utc)}
        )
        # Crear usuario dev
        user_id = str(uuid.uuid4())
        await db.execute(
            text("""
                INSERT INTO users (id, email, password_hash, tenant_id, role, created_at)
                VALUES (:id, :email, :ph, :tid, 'admin', :now)
            """),
            {
                "id": user_id,
                "email": DEV_EMAIL,
                "ph": get_password_hash(DEV_PASSWORD),
                "tid": tenant_id,
                "now": datetime.now(timezone.utc)
            }
        )
        await db.commit()

    access_token = create_access_token(
        data={"sub": user_id, "tenant_id": tenant_id, "role": "admin"}
    )

    return {
        "tenant_id": tenant_id,
        "access_token": access_token,
        "email": DEV_EMAIL,
        "password": DEV_PASSWORD,
        "hint": "Usa estas credenciales para iniciar sesión en el dashboard"
    }
