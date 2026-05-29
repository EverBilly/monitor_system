$ConfigPath = "C:\MonitorAgent\config.json"
if (-not (Test-Path $ConfigPath)) {
    Write-Host "ERROR: No se encontro config.json" -ForegroundColor Red
    exit 1
}

$Config     = Get-Content $ConfigPath | ConvertFrom-Json
$ApiUrl     = $Config.api_url
$Email      = $Config.email
$Password   = $Config.password
$Interval   = if ($Config.interval_seconds) { $Config.interval_seconds } else { 30 }
$LoginUrl   = $ApiUrl -replace "/metrics$", "/auth/login"
$MachineId  = $env:COMPUTERNAME

function Write-Log {
    param([string]$Level, [string]$Msg)
    $Line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')][$Level] $Msg"
    Write-Output $Line
    Add-Content -Path "C:\MonitorAgent\agent.log" -Value $Line -ErrorAction SilentlyContinue
}

function Get-Token {
    try {
        $Body = "{`"email`":`"$Email`",`"password`":`"$Password`"}"
        $R = Invoke-RestMethod -Uri $LoginUrl -Method Post -Body $Body -ContentType "application/json" -ErrorAction Stop
        Write-Log "OK" "Autenticado | tenant: $($R.user.tenant_id.Substring(0,8))..."
        return @{
            token     = $R.token.access_token
            tenant_id = $R.user.tenant_id
            expires   = (Get-Date).AddMinutes(55)
        }
    } catch {
        Write-Log "ERR" "Login fallido: $($_.Exception.Message)"
        return $null
    }
}

function Send-Metrics {
    param([string]$TenantId, [hashtable]$Headers)

    # CPU
    $Cpu = [math]::Round(
        (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average, 2)

    # RAM
    $Os     = Get-CimInstance Win32_OperatingSystem
    $RamPct = [math]::Round((($Os.TotalVisibleMemorySize - $Os.FreePhysicalMemory) / $Os.TotalVisibleMemorySize) * 100, 2)

    # Disco — forzar array aunque haya un solo disco
    $DiskArr = @(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
        $UsedPct = if ($_.Size -gt 0) { [math]::Round(($_.Size - $_.FreeSpace) / $_.Size * 100, 2) } else { 0 }
        [PSCustomObject]@{ device = $_.DeviceID; used_pct = $UsedPct }
    })

    # Uptime
    $Uptime = [math]::Round(((Get-Date) - $Os.LastBootUpTime).TotalHours, 2)

    # IP — manejar null
    $IpObj = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
             Where-Object { $_.InterfaceAlias -notmatch "Loopback|vEthernet" -and $_.PrefixOrigin -match "Dhcp|Manual" } |
             Select-Object -First 1
    $Ip = if ($IpObj) { $IpObj.IPAddress } else { "0.0.0.0" }

    # Construir payload como PSCustomObject para serializar correctamente
    $Payload = [PSCustomObject]@{
        tenant_id       = $TenantId
        machine_id      = $MachineId
        cpu_pct         = $Cpu
        ram_pct         = $RamPct
        disk            = $DiskArr
        uptime_hours    = $Uptime
        security_events = "[]"
        ip              = $Ip
        timestamp       = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }

    $Body = $Payload | ConvertTo-Json -Depth 5 -Compress

    try {
        $Resp = Invoke-RestMethod -Uri $ApiUrl -Method Post -Headers $Headers -Body $Body -ContentType "application/json" -ErrorAction Stop
        Write-Log "OK" "CPU ${Cpu}%  RAM ${RamPct}%  IP $Ip"
        return $true
    } catch {
        $Code = $_.Exception.Response.StatusCode.value__
        Write-Log "ERR" "HTTP $Code - $($_.Exception.Message)"
        if ($Code -eq 401) { return $false }
        return $true
    }
}

Write-Log "OK" "Agente iniciado | $MachineId | intervalo: ${Interval}s"
Start-Sleep -Seconds 2

$Auth = Get-Token
if (-not $Auth) {
    Write-Log "ERR" "No se pudo autenticar - abortando"
    exit 1
}

$Errors = 0
while ($true) {
    if ((Get-Date) -gt $Auth.expires) {
        Write-Log "OK" "Renovando token..."
        $Auth = Get-Token
        if (-not $Auth) { Start-Sleep -Seconds 60; continue }
    }

    $Headers = @{
        "Authorization" = "Bearer $($Auth.token)"
        "Content-Type"  = "application/json"
    }

    $Ok = Send-Metrics -TenantId $Auth.tenant_id -Headers $Headers
    if (-not $Ok) {
        $Auth.expires = (Get-Date).AddSeconds(-1)
        $Errors++
    } else {
        $Errors = 0
    }

    if ($Errors -ge 10) {
        Write-Log "ERR" "Demasiados errores - esperando 5 min"
        Start-Sleep -Seconds 300
        $Errors = 0
    }

    Start-Sleep -Seconds $Interval
}