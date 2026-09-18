# PowerShell script for uninstalling hustnet CLI on Windows
param (
    [string]$InstallDir = $(Join-Path $env:LOCALAPPDATA "Programs\hustnet")
)

$ErrorActionPreference = "Stop"

Write-Host "==> 正在卸载 Windows 下的 hustnet CLI ..." -ForegroundColor Cyan

# 1. 移除安装目录及其中的脚本文件
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
    Write-Host "==> 已删除目录: $InstallDir" -ForegroundColor Green
} else {
    Write-Host "提示: 未找到目录 $InstallDir，可能已删除。" -ForegroundColor Yellow
}

# 2. 从 Windows 用户级 PATH 环境变量中清理该路径
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not [string]::IsNullOrWhiteSpace($UserPath)) {
    $Paths = ($UserPath -split ";") | Where-Object { 
        -not [string]::IsNullOrWhiteSpace($_) -and $_.TrimEnd('\') -ne $InstallDir.TrimEnd('\') 
    }
    $NewPath = $Paths -join ";"
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    Write-Host "==> 已从当前用户的 PATH 环境变量中移除该路径。" -ForegroundColor Green
}

Write-Host "==> Windows 卸载完成，环境已恢复干净。" -ForegroundColor Green
