# Local Context Bridge — Windows launcher (PowerShell 7+ / Windows PowerShell 5.1)
# Equivalent of bridge-macos.sh. Does not use Edge-specific APIs.
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'status', 'logs', 'open', 'help')]
  [string]$Command = 'help',

  [switch]$Docker,

  [string]$Project = '',

  [string]$Alias = 'project'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Version = if ($env:BRIDGE_VERSION) { $env:BRIDGE_VERSION } else { '0.1.0' }
$Port = if ($env:BRIDGE_PORT) { $env:BRIDGE_PORT } else { '32178' }
$BaseUrl = "http://127.0.0.1:$Port"
$DataDir = if ($env:LOCAL_CONTEXT_BRIDGE_DATA) {
  $env:LOCAL_CONTEXT_BRIDGE_DATA
} else {
  Join-Path $env:LOCALAPPDATA 'LocalContextBridge'
}
$PidFile = Join-Path $DataDir 'bridge.pid'
$LogFile = Join-Path $DataDir 'bridge.log'
$ComposeFile = Join-Path $Root 'docker\compose.yaml'

function Show-Usage {
  @"
Local Context Bridge $Version

Usage:
  .\bridge-windows.ps1 start [-Docker] -Project C:\absolute\path\to\project [-Alias NAME]
  .\bridge-windows.ps1 stop
  .\bridge-windows.ps1 status
  .\bridge-windows.ps1 logs
  .\bridge-windows.ps1 open

First-time Chrome extension install (manual):
  chrome://extensions → Developer mode → Load unpacked → extension\dist
"@
}

function Wait-Healthy {
  for ($i = 0; $i -lt 60; $i++) {
    try {
      Invoke-RestMethod -Uri "$BaseUrl/health" -TimeoutSec 2 | Out-Null
      return $true
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

function Register-Project([string]$Path, [string]$AliasName) {
  $body = @{ path = $Path; alias = $AliasName; primary = $true } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/local/register-root" `
    -ContentType 'application/json' -Headers @{ Origin = 'http://127.0.0.1:32178' } `
    -Body $body | Out-Null
}

switch ($Command) {
  'help' { Show-Usage; break }
  'start' {
    if (-not $Project) { throw 'missing -Project' }
    if (-not [System.IO.Path]::IsPathRooted($Project)) { throw 'project path must be absolute' }
    if (-not (Test-Path -LiteralPath $Project -PathType Container)) { throw "directory not found: $Project" }
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

    if ($Docker) {
      @"
PROJECT_HOST_PATH=$Project
BRIDGE_PRIMARY_ALIAS=$Alias
"@ | Set-Content -Encoding utf8 (Join-Path $DataDir '.env.bridge')
      Push-Location (Join-Path $Root 'docker')
      docker compose --env-file (Join-Path $DataDir '.env.bridge') --profile bridge -f $ComposeFile up -d --build
      Pop-Location
      if (-not (Wait-Healthy)) { throw 'companion unhealthy' }
      try { Register-Project '/workspace/primary' $Alias } catch {}
    } else {
      $bin = Join-Path $Root 'native\windows-x64\LocalContextBridge.Api.exe'
      if (-not (Test-Path $bin)) {
        if (Get-Command dotnet -ErrorAction SilentlyContinue) {
          $out = Join-Path $Root 'native\windows-x64'
          New-Item -ItemType Directory -Force -Path $out | Out-Null
          Push-Location (Join-Path $Root 'companion')
          dotnet publish src\LocalContextBridge.Api\LocalContextBridge.Api.csproj -c Release -r win-x64 -o $out
          Pop-Location
        } else {
          throw "native binary missing: $bin"
        }
      }
      $env:LOCAL_CONTEXT_BRIDGE_DATA = $DataDir
      $env:ASPNETCORE_URLS = "http://127.0.0.1:$Port"
      $p = Start-Process -FilePath $bin -RedirectStandardOutput $LogFile -RedirectStandardError $LogFile -PassThru -WindowStyle Hidden
      Set-Content -Path $PidFile -Value $p.Id
      if (-not (Wait-Healthy)) { throw "start failed; see $LogFile" }
      Register-Project $Project $Alias
    }
    Write-Host "Healthy at $BaseUrl"
    Write-Host "Load unpacked extension from: $(Join-Path $Root 'extension\dist')"
    Start-Process "$BaseUrl/local"
  }
  'stop' {
    $envFile = Join-Path $DataDir '.env.bridge'
    if (Test-Path $envFile) {
      Push-Location (Join-Path $Root 'docker')
      docker compose --env-file $envFile --profile bridge -f $ComposeFile down 2>$null
      Pop-Location
    }
    if (Test-Path $PidFile) {
      $id = Get-Content $PidFile
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
      Remove-Item $PidFile -Force
    }
    Write-Host 'Stopped.'
  }
  'status' {
    try {
      Invoke-RestMethod "$BaseUrl/health"
      Write-Host 'status: healthy'
    } catch {
      Write-Host 'status: offline'
      exit 1
    }
  }
  'logs' {
    if (Test-Path $LogFile) { Get-Content $LogFile -Tail 200 } else { Write-Host 'No logs.' }
  }
  'open' { Start-Process "$BaseUrl/local" }
}
