<#
.SYNOPSIS
    Instalador del agente de monitoreo — con cifrado de credenciales (DPAPI).
    Ejecutar como Administrador.
#>
param(
    [string]$ApiUrl   = "",
    [string]$Email    = "",
    [string]$Password = "",
    [int]$IntervalSeconds = 30
)

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Error "Ejecutar como Administrador."; exit 1 }

Write-Host "`n╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host   "║     Monitor System — Instalador          ║" -ForegroundColor Cyan
Write-Host   "╚══════════════════════════════════════════╝`n" -ForegroundColor Cyan

if (-not $ApiUrl)   { $ApiUrl   = Read-Host "URL del backend (https://tu-api.onrender.com/api/v1/metrics)" }
if (-not $Email)    { $Email    = Read-Host "Email de tu cuenta" }
if (-not $Password) {
    $ss       = Read-Host "Contraseña" -AsSecureString
    $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss))
}

# ── Verificar credenciales con el backend ─────────────────────────────────────
Write-Host "🔍 Verificando credenciales..." -ForegroundColor Yellow
$loginUrl = $ApiUrl -replace "/metrics$", "/auth/login"
try {
    $resp     = Invoke-RestMethod -Uri $loginUrl -Method Post -ContentType "application/json" `
                    -Body (@{email=$Email; password=$Password} | ConvertTo-Json) -ErrorAction Stop
    $tenantId = $resp.user.tenant_id
    Write-Host "✅ Credenciales válidas | tenant: $($tenantId.Substring(0,8))..." -ForegroundColor Green
} catch {
    Write-Host "❌ Error $($_.Exception.Response.StatusCode.value__) — credenciales incorrectas o URL inválida" -ForegroundColor Red
    exit 1
}

# ── Cifrar la contraseña con DPAPI (ligada al equipo + cuenta SYSTEM) ────────
# ConvertFrom-SecureString sin -Key usa DPAPI del usuario actual.
# Para que SYSTEM pueda descifrarla usamos una clave derivada del SID del equipo.
function Get-MachineKey {
    $sid   = (Get-WmiObject Win32_UserAccount -Filter "Name='Administrator'").SID
    if (-not $sid) { $sid = "$env:COMPUTERNAME-monitor-2024-static" }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($sid.PadRight(32).Substring(0,32))
    return [byte[]]$bytes
}

$key            = Get-MachineKey
$encryptedPass  = ConvertTo-SecureString $Password -AsPlainText -Force |
                  ConvertFrom-SecureString -Key $key

# ── Crear carpeta y guardar config cifrada ─────────────────────────────────────
$AgentDir = "C:\MonitorAgent"
New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null

$config = @{
    api_url          = $ApiUrl
    email            = $Email
    encrypted_pass   = $encryptedPass      # ← cifrado, no texto plano
    interval_seconds = $IntervalSeconds
    installed_at     = (Get-Date).ToString("o")
} | ConvertTo-Json

Set-Content "$AgentDir\config.json" -Value $config -Encoding UTF8
# Solo SYSTEM y Admins pueden leer el archivo
icacls "$AgentDir\config.json" /inheritance:r /grant "SYSTEM:(R)" /grant "Administrators:(R)" | Out-Null
Write-Host "🔐 Config guardada (contraseña cifrada con DPAPI)" -ForegroundColor Cyan

# ── Copiar scripts ─────────────────────────────────────────────────────────────
$src = Join-Path $PSScriptRoot "monitor-agent.ps1"
if (-not (Test-Path $src)) { Write-Error "No se encontró monitor-agent.ps1"; exit 1 }
Copy-Item $src "$AgentDir\monitor-agent.ps1" -Force

# ── Tarea programada como SYSTEM ──────────────────────────────────────────────
$TaskName = "MonitorSystemAgent"
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $TaskName `
    -Action    (New-ScheduledTaskAction -Execute "powershell.exe" `
                    -Argument "-NonInteractive -NoProfile -ExecutionPolicy Bypass -File `"$AgentDir\monitor-agent.ps1`"") `
    -Trigger   (New-ScheduledTaskTrigger -AtStartup) `
    -Settings  (New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
                    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable) `
    -Principal (New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest) `
    -Description "Monitor System — $ApiUrl" | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

Write-Host "`n╔══════════════════════════════════════════╗" -ForegroundColor Green
Write-Host   "║        ✅ Instalación completada          ║" -ForegroundColor Green
Write-Host   "╚══════════════════════════════════════════╝"  -ForegroundColor Green
Write-Host "  Máquina:  $env:COMPUTERNAME"
Write-Host "  Tenant:   $($tenantId.Substring(0,8))..."
Write-Host "  Logs:     $AgentDir\agent.log"
Write-Host "`nPara desinstalar:"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false" -ForegroundColor Gray
Write-Host "  Remove-Item 'C:\MonitorAgent' -Recurse -Force" -ForegroundColor Gray
