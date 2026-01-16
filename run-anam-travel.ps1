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

    function Get-BrowserPath {
      param(
        [string[]]$Commands,
        [string[]]$Paths
      )

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
