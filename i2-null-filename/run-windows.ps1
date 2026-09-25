# Windows: start the observer under Bare in a second process, hit its directory with the load
# generator, and report how the observer ended. Then the same with Node as the control.
#
#   .\run-windows.ps1 [-Files 20000] [-Mode all] [-Rounds 1]
#
# Expected with bare-fs 4.8.1: the Bare observer exits with -1073741819 (0xC0000005, access
# violation) shortly after the load starts; the Node observer survives and reports null filenames.
param(
  [int]$Files = 20000,
  [string]$Mode = 'all',
  [int]$Rounds = 1
)
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund | Out-Null }

function Run-Observer([string]$label, [string[]]$cmd) {
  $dir = Join-Path $env:TEMP ("bare-fs-repro-" + $label + "-" + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $out = Join-Path $here ("observer-" + $label + ".log")
  $err = Join-Path $here ("observer-" + $label + ".err")
  Write-Host "== $label observer: $($cmd -join ' ') $dir"
  $p = Start-Process -FilePath $cmd[0] -ArgumentList (($cmd[1..($cmd.Length-1)] + @($dir, '--seconds', '20')) -join ' ') `
       -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -NoNewWindow
  Start-Sleep -Seconds 2
  Write-Host "== load"
  node load.js $dir --files $Files --mode $Mode --rounds $Rounds
  $p.WaitForExit(30000) | Out-Null
  if (-not $p.HasExited) { $p.Kill() }
  Write-Host "== $label observer output"
  Get-Content $out
  if ((Get-Item $err).Length -gt 0) { Get-Content $err }
  $code = $p.ExitCode
  $hex = if ($code -lt 0) { '0x' + ('{0:X8}' -f ($code -band 0xFFFFFFFF)) } else { $code }
  Write-Host "== $label observer exit code: $code ($hex)"
  if ($code -eq -1073741819) { Write-Host "   -> ACCESS VIOLATION: the NULL-filename crash (bare-fs#52)" }
  Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
}

Run-Observer 'bare' @('node', 'node_modules\bare-runtime\bin\bare', 'observer.js')
Run-Observer 'node' @('node', 'observer.js')
