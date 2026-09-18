# PowerShell script for uninstalling hustnet CLI on Windows
param (
    [string]$InstallDir = "$HOME\.local\bin"
)

$ErrorActionPreference = "Stop"

Write-Host "==> 正在卸载 Windows 下的 hustnet CLI ..." -ForegroundColor Cyan

$CmdPath = Join-Path $InstallDir "hustnet.cmd"
$Ps1Path = Join-Path $InstallDir "hustnet.ps1"

$RemovedAny = $false

if (Test-Path $CmdPath) {
    Remove-Item -Path $CmdPath -Force
    Write-Host "==> 已移除: $CmdPath" -ForegroundColor Green
    $RemovedAny = $true
}

if (Test-Path $Ps1Path) {
    Remove-Item -Path $Ps1Path -Force
    Write-Host "==> 已移除: $Ps1Path" -ForegroundColor Green
    $RemovedAny = $true
}

if (-not $RemovedAny) {
    Write-Host "提示: 未在 $InstallDir 找到 hustnet 相关脚本文件，可能尚未安装或已被清理。" -ForegroundColor Yellow
} else {
    Write-Host "卸载完成。" -ForegroundColor Green
}
