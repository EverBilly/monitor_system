from datetime import datetime, timezone
from app.schemas import MetricPayload, AlertResponse

def check_anomalies(data: MetricPayload) -> list[AlertResponse]:
    """Detecta anomalías en las métricas recibidas"""
    alerts = []
    
    # Umbral CPU
    if data.cpu_pct > 85:
        alerts.append(AlertResponse(
            machine_id=data.machine_id,
            severity="high" if data.cpu_pct < 95 else "critical",
            rule=f"CPU > {data.cpu_pct:.1f}%",
            triggered_at=data.timestamp
        ))
    
    # Umbral RAM
    if data.ram_pct > 90:
        alerts.append(AlertResponse(
            machine_id=data.machine_id,
            severity="high" if data.ram_pct < 98 else "critical",
            rule=f"RAM > {data.ram_pct:.1f}%",
            triggered_at=data.timestamp
        ))
    
    # Eventos de seguridad
    if data.security_events:
        import json
        try:
            events = json.loads(data.security_events) if isinstance(data.security_events, str) else data.security_events
            if isinstance(events, list) and len(events) > 3:
                alerts.append(AlertResponse(
                    machine_id=data.machine_id,
                    severity="medium",
                    rule=f"{len(events)} eventos de seguridad en 5min",
                    triggered_at=data.timestamp
                ))
        except (json.JSONDecodeError, TypeError):
            pass
    
    return alerts