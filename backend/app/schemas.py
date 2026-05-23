from pydantic import BaseModel, Field, validator, EmailStr
from typing import Optional, List
from datetime import datetime, timezone

# =============================================================================
# MÉTRICAS (existentes)
# =============================================================================
class MetricPayload(BaseModel):
    tenant_id: str
    machine_id: str
    cpu_pct: float = Field(ge=0, le=100)
    ram_pct: float = Field(ge=0, le=100)
    disk: List[dict]
    uptime_hours: float
    security_events: Optional[str] = None
    ip: Optional[str] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class AlertResponse(BaseModel):
    machine_id: str
    severity: str
    rule: str
    triggered_at: datetime

# =============================================================================
# AUTENTICACIÓN (nuevos)
# =============================================================================
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    tenant_name: str = Field(..., min_length=3, max_length=50)
    
    @validator('password')
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError('La contraseña debe tener al menos 8 caracteres')
        if not any(c.isupper() for c in v) or not any(c.isdigit() for c in v):
            raise ValueError('La contraseña debe incluir mayúsculas y números')
        return v

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600

class UserResponse(BaseModel):
    id: str
    email: EmailStr
    tenant_id: str
    tenant_name: str
    role: str = "admin"
    created_at: datetime
    
    class Config:
        from_attributes = True

class AuthResponse(BaseModel):
    user: UserResponse
    token: Token