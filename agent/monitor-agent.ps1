<#
.SYNOPSIS
    Agente de monitoreo — lee configuración con contraseña cifrada (DPAPI).
#>

$ConfigPath = "C:\MonitorAgent\config.json"
if (-not (Test-Path $ConfigPath)) { Write-Error "Falta $ConfigPath"; exit 1 }

$Config   = Get-Content $ConfigPath | ConvertFrom-Json
$ApiUrl   = $Config.api_url
$Email    = $Config.email
$Interval = if ($Config.interval_seconds) { $Config.interval_seconds } else { 30 }

# ── Descifrar contraseña (DPAPI, misma clave que el instalador) ───────────────
function Get-MachineKey {
    $sid   = (Get-WmiObject Win32_UserAccount -Filter "Name='Administrator'").SID
    if (-not $sid) { $sid = "$env:COMPUTERNAME-monitor-2024-static" }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($sid.PadRight(32).Substring(0,32))
    return [byte[]]$bytes
}

$key      = Get-MachineKey
$Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
                    (ConvertTo-SecureString $Config.encrypted_pass -Key $key)))

$LoginUrl  = $ApiUrl -replace "/metrics$", "/auth/login"
$MachineId = $env:COMPUTERNAME

function Write-Log($Level, $Msg) {
    $line = "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')][$Level] $Msg"
    Write-Output $line
    Add-Content "C:\MonitorAgent\agent.log" $line -ErrorAction SilentlyContinue
}

function Get-AuthToken {
    try {
        $r = Invoke-RestMethod -Uri $LoginUrl -Method Post -ContentType "application/json" `
                -Body (@{email=$Email; password=$Password} | ConvertTo-Json) -ErrorAction Stop
        Write-Log "OK" "Autenticado | tenant: $($r.user.tenant_id.Substring(0,8))..."
        return @{ token=$r.token.access_token; tenant_id=$r.user.tenant_id; expires=(Get-Date).AddMinutes(55) }
    } catch {
        Write-Log "ERR" "Login fallido: $_"
        return $null
    }
}

function Get-Metrics($TenantId) {
    $cpu     = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
    $os      = Get-CimInstance Win32_OperatingSystem
    $ramPct  = [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize) * 100, 2)
    $disk    = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
                   @{ device=$_.DeviceID; used_pct=[math]::Round(($_.Size-$_.FreeSpace)/$_.Size*100,2) } }
    $uptime  = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 2)
    $ip      = (Get-NetIPAddress -AddressFamily IPv4 |
                Where-Object { $_.InterfaceAlias -notmatch "Loopback|vEthernet" -and
                               $_.PrefixOrigin -match "Dhcp|Manual" } | Select-Object -First 1).IPAddress
    $secEvts = @()
    try {
        $secEvts = Get-WinEvent -FilterHashtable @{LogName="Security";StartTime=(Get-Date).AddMinutes(-5);Id=4625,4648,4720,4726} `
                   -ErrorAction SilentlyContinue |
                   Select-Object @{n="id";e={$_.Id}}, @{n="time";e={$_.TimeCreated.ToString("o")}},
                                 @{n="message";e={$_.Message.Split("`n")[0].Trim()}}
    } catch {}

    return @{
        tenant_id=$TenantId; machine_id=$MachineId; cpu_pct=[math]::Round($cpu,2)
        ram_pct=$ramPct; disk=$disk; uptime_hours=$uptime
        security_events=($secEvts | ConvertTo-Json -Compress); ip=$ip
        timestamp=(Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    }
}

Write-Log "OK" "Agente iniciado | $MachineId | intervalo: ${Interval}s"
$auth = Get-AuthToken
if (-not $auth) { Write-Log "ERR" "No se pudo autenticar — abortando"; exit 1 }

$errors = 0
while ($true) {
    if ((Get-Date) -gt $auth.expires) {
        $auth = Get-AuthToken
        if (-not $auth) { Start-Sleep 60; continue }
    }
    $headers = @{ "Authorization"="Bearer $($auth.token)"; "Content-Type"="application/json" }
    try {
        $m    = Get-Metrics -TenantId $auth.tenant_id
        $resp = Invoke-RestMethod -Uri $ApiUrl -Method Post -Headers $headers `
                    -Body ($m | ConvertTo-Json -Depth 4) -ErrorAction Stop
        $status = if (($resp | Measure-Object).Count -gt 0) { "⚠️ ALERTA" } else { "OK" }
        Write-Log $status "CPU $($m.cpu_pct)%  RAM $($m.ram_pct)%  | $status"
        $errors = 0
    } catch {
        $errors++
        $code = $_.Exception.Response.StatusCode.value__
        Write-Log "ERR" "HTTP $code — $_"
        if ($code -eq 401) { $auth.expires = (Get-Date).AddSeconds(-1) }
        if ($errors -ge 10) { Start-Sleep 300; $errors = 0 }
    }
    Start-Sleep $Interval
}
