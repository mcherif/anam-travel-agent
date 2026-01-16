param(
  [switch]$Install,
  [switch]$NoBrowser
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

if (!(Test-Path -LiteralPath $backend)) {
  Write-Error "Backend folder not found: $backend"
  exit 1
}

if (!(Test-Path -LiteralPath $frontend)) {
  Write-Error "Frontend folder not found: $frontend"
  exit 1
}

if ($Install -or !(Test-Path -LiteralPath (Join-Path $backend 'node_modules'))) {
  Write-Host "Installing backend dependencies..."
  Push-Location $backend
  npm install
  Pop-Location
}

if ($Install -or !(Test-Path -LiteralPath (Join-Path $frontend 'node_modules'))) {
  Write-Host "Installing frontend dependencies..."
  Push-Location $frontend
  npm install
  Pop-Location
}

Write-Host "Starting backend and frontend in separate windows..."

$backendProc = Start-Process -FilePath "powershell" -ArgumentList @(
  "-NoProfile",
  "-Command",
  "Set-Location -LiteralPath `"$backend`"; npm start"
) -PassThru

$frontendProc = Start-Process -FilePath "powershell" -ArgumentList @(
  "-NoProfile",
  "-Command",
  "Set-Location -LiteralPath `"$frontend`"; npm run dev"
) -PassThru

function Stop-ChildProcesses {
  foreach ($proc in @($backendProc, $frontendProc)) {
    if ($proc -and !$proc.HasExited) {
      try {
        & taskkill /T /F /PID $proc.Id | Out-Null
      } catch {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

try {
  if ($NoBrowser) {
    Write-Host "Press Enter to stop both servers."
    Read-Host | Out-Null
  } else {
    $url = "http://localhost:3000"
    $browserProc = $null

    $edge = Get-Command msedge -ErrorAction SilentlyContinue
    $chrome = Get-Command chrome -ErrorAction SilentlyContinue
    $brave = Get-Command brave -ErrorAction SilentlyContinue
    $firefox = Get-Command firefox -ErrorAction SilentlyContinue

    if ($edge) {
      $browserProc = Start-Process -FilePath $edge.Path -ArgumentList @("--new-window", "--app=$url") -PassThru
    } elseif ($chrome) {
      $browserProc = Start-Process -FilePath $chrome.Path -ArgumentList @("--new-window", "--app=$url") -PassThru
    } elseif ($brave) {
      $browserProc = Start-Process -FilePath $brave.Path -ArgumentList @("--new-window", "--app=$url") -PassThru
    } elseif ($firefox) {
      $browserProc = Start-Process -FilePath $firefox.Path -ArgumentList @("-new-instance", "-private-window", $url) -PassThru
    } else {
      Start-Process -FilePath $url | Out-Null
      Write-Host "Browser opened. Press Enter to stop both servers."
      Read-Host | Out-Null
    }

    if ($browserProc) {
      Write-Host "Close the app window to stop both servers."
      Wait-Process -Id $browserProc.Id
    }
  }
} finally {
  Stop-ChildProcesses
}
