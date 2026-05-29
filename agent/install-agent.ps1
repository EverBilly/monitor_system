param(
    [string]$ApiUrl = "",
    [string]$Email = "",
    [string]$Password = "",
    [int]$IntervalSeconds = 30
)

# Verificar que se ejecuta como Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Ejecutar como Administrador." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Monitor System - Instalador ===" -ForegroundColor Cyan
Write-Host ""

# Pedir datos si no se pasaron como parametros
if (-not $ApiUrl) {
    $ApiUrl = Read-Host "URL del backend (ej: https://monitor-api-i7bb.onrender.com/api/v1/metrics)"
}
if (-not $Email) {
    $Email = Read-Host "Email de tu cuenta"
}
if (-not $Password) {
    $SecurePass = Read-Host "Contrasena" -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePass))
}

# Verificar credenciales con el backend
Write-Host "Verificando credenciales..." -ForegroundColor Yellow
$LoginUrl = $ApiUrl -replace "/metrics$", "/auth/login"

try {
    $Body = '{"email":"' + $Email + '","password":"' + $Password + '"}'
    $Response = Invoke-RestMethod -Uri $LoginUrl -Method Post -Body $Body -ContentType "application/json" -ErrorAction Stop
    $TenantId = $Response.user.tenant_id
    Write-Host "OK - Credenciales validas | tenant: $($TenantId.Substring(0,8))..." -ForegroundColor Green
} catch {
    Write-Host "ERROR: Credenciales incorrectas o URL invalida" -ForegroundColor Red
    Write-Host $_.Exception.Message
    exit 1
}

# Crear carpeta del agente
$AgentDir = "C:\MonitorAgent"
New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null

# Guardar configuracion
$ConfigContent = '{"api_url":"' + $ApiUrl + '","email":"' + $Email + '","password":"' + $Password + '","interval_seconds":' + $IntervalSeconds + '}'
Set-Content -Path "$AgentDir\config.json" -Value $ConfigContent -Encoding UTF8

# Copiar script del agente
$ScriptSrc = Join-Path $PSScriptRoot "monitor-agent.ps1"
if (Test-Path $ScriptSrc) {
    Copy-Item -Path $ScriptSrc -Destination "$AgentDir\monitor-agent.ps1" -Force
    Write-Host "Script copiado a $AgentDir" -ForegroundColor Cyan
} else {
    Write-Host "ERROR: No se encontro monitor-agent.ps1 en la misma carpeta" -ForegroundColor Red
    exit 1
}

# Crear tarea programada
$TaskName = "MonitorSystemAgent"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NonInteractive -NoProfile -ExecutionPolicy Bypass -File `"$AgentDir\monitor-agent.ps1`""
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Description "Monitor System Agent" | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "=== Instalacion completada ===" -ForegroundColor Green
Write-Host "Maquina:   $env:COMPUTERNAME"
Write-Host "Tenant:    $($TenantId.Substring(0,8))..."
Write-Host "Logs:      $AgentDir\agent.log"
Write-Host ""
Write-Host "Para desinstalar:" -ForegroundColor Gray
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false" -ForegroundColor Gray
Write-Host "  Remove-Item 'C:\MonitorAgent' -Recurse -Force" -ForegroundColor Gray