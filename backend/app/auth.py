from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from app.database import get_db, AsyncSession
from app.schemas import UserRegister, UserLogin, AuthResponse, Token, UserResponse
from app.security.jwt import verify_password, get_password_hash, create_access_token, get_current_user
from datetime import datetime, timezone
from slowapi import Limiter
from slowapi.util import get_remote_address
import uuid, re

router  = APIRouter(tags=["auth"])
limiter = Limiter(key_func=get_remote_address)

# Validación de contraseña mínima (8+ chars, 1 mayúscula, 1 número)
_PASSWORD_RE = re.compile(r'^(?=.*[A-Z])(?=.*\d).{8,}$')


def _validate_password(password: str):
    if not _PASSWORD_RE.match(password):
        raise HTTPException(
            status_code=400,
            detail="La contraseña debe tener al menos 8 caracteres, una mayúscula y un número"
        )


# =============================================================================
# POST /register
# Rate limit: 3 registros por hora por IP — evita creación masiva de cuentas
# =============================================================================
@router.post("/register", response_model=AuthResponse, status_code=201)
@limiter.limit("3/hour")
async def register_user(request: Request, payload: UserRegister, db: AsyncSession = Depends(get_db)):
    _validate_password(payload.password)

    result = await db.execute(
        text("SELECT id FROM users WHERE email = :email"),
        {"email": payload.email.lower()}
    )
    if result.fetchone():
        raise HTTPException(status_code=400, detail="Este email ya está registrado")

    tenant_id = str(uuid.uuid4())
    user_id   = str(uuid.uuid4())
    now       = datetime.now(timezone.utc)

    await db.execute(
        text("INSERT INTO tenants (id, name, created_at) VALUES (:id, :name, :now)"),
        {"id": tenant_id, "name": payload.tenant_name, "now": now}
    )
    await db.execute(
        text("""INSERT INTO users (id, email, password_hash, tenant_id, role, created_at)
                VALUES (:id, :email, :ph, :tid, 'admin', :now)"""),
        {"id": user_id, "email": payload.email.lower(),
         "ph": get_password_hash(payload.password), "tid": tenant_id, "now": now}
    )
    await db.commit()

    token = create_access_token({"sub": user_id, "tenant_id": tenant_id, "role": "admin"})
    return AuthResponse(
        user=UserResponse(id=user_id, email=payload.email.lower(), tenant_id=tenant_id,
                          tenant_name=payload.tenant_name, role="admin", created_at=now),
        token=Token(access_token=token)
    )


# =============================================================================
# POST /login
# Rate limit: 10 intentos por minuto por IP — bloquea fuerza bruta
# El mensaje de error es idéntico para email inexistente y contraseña incorrecta
# (evita user enumeration)
# =============================================================================
@router.post("/login", response_model=AuthResponse)
@limiter.limit("10/minute")
async def login_user(request: Request, payload: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        text("""SELECT u.id, u.email, u.password_hash, u.tenant_id, u.role, t.name AS tenant_name
                FROM users u JOIN tenants t ON u.tenant_id = t.id
                WHERE u.email = :email"""),
        {"email": payload.email.lower()}
    )
    row = result.fetchone()

    # Mismo mensaje para email inválido Y contraseña incorrecta — evita user enumeration
    _INVALID = HTTPException(
        status_code=401,
        detail="Email o contraseña incorrectos",
        headers={"WWW-Authenticate": "Bearer"}
    )

    if not row:
        raise _INVALID
    if not verify_password(payload.password, row.password_hash):
        raise _INVALID

    token = create_access_token(
        {"sub": str(row.id), "tenant_id": str(row.tenant_id), "role": row.role}
    )
    return AuthResponse(
        user=UserResponse(id=str(row.id), email=row.email, tenant_id=str(row.tenant_id),
                          tenant_name=row.tenant_name, role=row.role,
                          created_at=datetime.now(timezone.utc)),
        token=Token(access_token=token)
    )


# =============================================================================
# GET /me — requiere JWT válido
# =============================================================================
@router.get("/me")
async def get_me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession   = Depends(get_db),
):
    result = await db.execute(
        text("""SELECT u.email, u.role, t.name AS tenant_name
                FROM users u JOIN tenants t ON u.tenant_id = t.id
                WHERE u.id = :uid"""),
        {"uid": current_user["user_id"]}
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    return {
        "user_id":     current_user["user_id"],
        "email":       row.email,
        "role":        row.role,
        "tenant_id":   current_user["tenant_id"],
        "tenant_name": row.tenant_name,
    }
