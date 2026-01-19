param(
  [switch]$Install,
  [switch]$NoBrowser,
  [string]$LogPath,
  [string]$BackendLogPath,
  [string]$FrontendLogPath
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'

$logEnabled = [string]::IsNullOrWhiteSpace($LogPath) -eq $false
$backendStdout = $null
$backendStderr = $null
$frontendStdout = $null
$frontendStderr = $null

if ($logEnabled) {
  $logDir = Split-Path -Parent $LogPath
  if (-not $logDir) {
    $logDir = $root
  }
  if ($logDir -and !(Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  }
  "" | Out-File -FilePath $LogPath -Encoding utf8

  $backendStdout = if ($BackendLogPath) { $BackendLogPath } else { Join-Path $logDir 'run-anam-travel-backend.out.log' }
  $frontendStdout = if ($FrontendLogPath) { $FrontendLogPath } else { Join-Path $logDir 'run-anam-travel-frontend.out.log' }
  $backendStderr = [IO.Path]::ChangeExtension($backendStdout, '.err.log')
  $frontendStderr = [IO.Path]::ChangeExtension($frontendStdout, '.err.log')

  "" | Out-File -FilePath $backendStdout -Encoding utf8
  "" | Out-File -FilePath $backendStderr -Encoding utf8
  "" | Out-File -FilePath $frontendStdout -Encoding utf8
  "" | Out-File -FilePath $frontendStderr -Encoding utf8

  "$(Get-Date -Format s) Backend logs: $backendStdout, $backendStderr" | Out-File -FilePath $LogPath -Append -Encoding utf8
  "$(Get-Date -Format s) Frontend logs: $frontendStdout, $frontendStderr" | Out-File -FilePath $LogPath -Append -Encoding utf8
}

function Write-Log([string]$Message) {
  if ($logEnabled) {
    $timestamp = (Get-Date).ToString('s')
    "$timestamp $Message" | Out-File -FilePath $LogPath -Append -Encoding utf8
  }
}

function Wait-ForPort([string[]]$Addresses, [int]$Port, [int]$TimeoutSec = 8) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    foreach ($address in $Addresses) {
      try {
        if (Test-NetConnection -ComputerName $address -Port $Port -InformationLevel Quiet) {
          return $true
        }
      } catch {
        # Ignore and retry.
      }
    }
    Start-Sleep -Milliseconds 250
  }

  return $false
}


function Get-BrowserPath([string[]]$Commands, [string[]]$Paths) {
  foreach ($command in $Commands) {
    $resolved = Get-Command $command -ErrorAction SilentlyContinue
    if ($resolved) {
      return $resolved.Path
    }
  }

  foreach ($candidate in $Paths) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

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

$nodeCommand = Get-Command node -ErrorAction Stop
$nodePath = $nodeCommand.Path
$backendScript = Join-Path $backend 'server.js'
$viteScript = Join-Path $frontend 'node_modules\vite\bin\vite.js'

if (!(Test-Path -LiteralPath $backendScript)) {
  Write-Error "Backend script not found: $backendScript"
  exit 1
}

if (!(Test-Path -LiteralPath $viteScript)) {
  Write-Error "Vite script not found: $viteScript"
  exit 1
}

Write-Log ('Launching backend: {0} {1}' -f $nodePath, $backendScript)
try {
  if ($backendStdout) {
    $backendProc = Start-Process -FilePath $nodePath -ArgumentList @($backendScript) -WorkingDirectory $backend -RedirectStandardOutput $backendStdout -RedirectStandardError $backendStderr -PassThru
  } else {
    $backendProc = Start-Process -FilePath $nodePath -ArgumentList @($backendScript) -WorkingDirectory $backend -PassThru
  }
  Write-Log "Backend PID: $($backendProc.Id)"
  Start-Sleep -Milliseconds 500
  if ($backendProc.HasExited) {
    Write-Log "Backend exited early with code $($backendProc.ExitCode)"
  }
} catch {
  Write-Log "Backend launch failed: $($_.Exception.Message)"
  throw
}

Write-Log ('Launching frontend: {0} {1}' -f $nodePath, $viteScript)
try {
  if ($frontendStdout) {
    $frontendProc = Start-Process -FilePath $nodePath -ArgumentList @($viteScript) -WorkingDirectory $frontend -RedirectStandardOutput $frontendStdout -RedirectStandardError $frontendStderr -PassThru
  } else {
    $frontendProc = Start-Process -FilePath $nodePath -ArgumentList @($viteScript) -WorkingDirectory $frontend -PassThru
  }
  Write-Log "Frontend PID: $($frontendProc.Id)"
  Start-Sleep -Milliseconds 500
  if ($frontendProc.HasExited) {
    Write-Log "Frontend exited early with code $($frontendProc.ExitCode)"
  }
} catch {
  Write-Log "Frontend launch failed: $($_.Exception.Message)"
  throw
}

function Stop-ChildProcesses {
  foreach ($proc in @($backendProc, $frontendProc)) {
    if ($proc -and !$proc.HasExited) {
      try {
        & taskkill /T /F /PID $proc.Id | Out-Null
      } catch {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Write-Log "Stopped PID: $($proc.Id)"
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

    Write-Host "Waiting for the frontend to start on $url ..."
    $frontendReady = Wait-ForPort -Addresses @('127.0.0.1', 'localhost') -Port 3000 -TimeoutSec 8
    if (-not $frontendReady) {
      Write-Log "Frontend not ready after 8s"
      Write-Host "Frontend did not start within 8 seconds. Check logs and open $url manually once it's ready."
    }

    if ($frontendReady) {
      Write-Host "Opening the app window..."

      $edgePath = Get-BrowserPath -Commands @('msedge') -Paths @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
      )
      $chromePath = Get-BrowserPath -Commands @('chrome') -Paths @(
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
      )
      $bravePath = Get-BrowserPath -Commands @('brave') -Paths @(
        "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
        "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
      )
      $firefoxPath = Get-BrowserPath -Commands @('firefox') -Paths @(
        "${env:ProgramFiles(x86)}\Mozilla Firefox\firefox.exe",
        "$env:ProgramFiles\Mozilla Firefox\firefox.exe"
      )

      if ($edgePath) {
        $browserProc = Start-Process -FilePath $edgePath -ArgumentList @("--new-window", "--app=$url") -PassThru
      } elseif ($chromePath) {
        $browserProc = Start-Process -FilePath $chromePath -ArgumentList @("--new-window", "--app=$url") -PassThru
      } elseif ($bravePath) {
        $browserProc = Start-Process -FilePath $bravePath -ArgumentList @("--new-window", "--app=$url") -PassThru
      } elseif ($firefoxPath) {
        $browserProc = Start-Process -FilePath $firefoxPath -ArgumentList @("-new-instance", "-private-window", $url) -PassThru
      } else {
        Start-Process -FilePath $url | Out-Null
      }
    }

    $browserFastExit = $false
    if ($browserProc) {
      Start-Sleep -Milliseconds 500
      if ($browserProc.HasExited) {
        $browserFastExit = $true
        Write-Log "Browser closed quickly; keeping servers running."
      }
    }

    if ($browserProc -and -not $browserFastExit) {
      Write-Host "Close the app window to stop both servers."
      try {
        if (-not $browserProc.HasExited) {
          Wait-Process -Id $browserProc.Id
        }
      } catch {
        Write-Log "Browser wait failed: $($_.Exception.Message)"
      }
    }

    if (-not $browserProc -or $browserFastExit) {
      Write-Host "Press Enter to stop both servers."
      Read-Host | Out-Null
    }
  }
} finally {
  Stop-ChildProcesses
}
