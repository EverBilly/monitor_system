from datetime import datetime, timedelta, timezone
from typing import Optional, Union
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status, Depends, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.config import get_settings
import uuid

settings = get_settings()

# Configuración de seguridad: usar argon2 (más seguro que bcrypt)
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")
security = HTTPBearer(auto_error=False)

# Constantes
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def _to_str(value: Union[str, uuid.UUID, None]) -> Optional[str]:
    """Convierte UUID o string a string seguro para JSON"""
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return str(value)
    return str(value)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Crea token JWT convirtiendo UUIDs a strings"""
    to_encode = {}
    for key, value in data.items():
        to_encode[key] = _to_str(value)
    
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
    
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> dict:
    """Extrae y valida el JWT de las peticiones"""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticación requerido",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    payload = decode_token(credentials.credentials)
    
    user_id: str = payload.get("sub")
    tenant_id: str = payload.get("tenant_id")
    role: str = payload.get("role", "user")
    
    if not user_id or not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token mal formado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return {"user_id": user_id, "tenant_id": tenant_id, "role": role}

async def require_tenant_match(
    current_user: dict = Depends(get_current_user),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID")  # ✅ CLAVE: extraer header correctamente
) -> str:
    """
    Valida que el tenant del token coincide con el header X-Tenant-ID.
    En desarrollo: si no hay header, usa el del token (más flexible).
    """
    # ✅ En desarrollo: si no hay header, confiar en el token
    if not x_tenant_id:
        return current_user["tenant_id"]
    
    # Normalizar para comparación (case-insensitive)
    if x_tenant_id.lower() != current_user["tenant_id"].lower():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Acceso denegado: tenant '{x_tenant_id}' no coincide con token"
        )
    
    return current_user["tenant_id"]