# PowerShell script for uninstalling hustnet CLI on Windows
param (
    [string]$InstallDir = $(Join-Path $env:LOCALAPPDATA "Programs\hustnet")
)

$ErrorActionPreference = "Stop"

Write-Host "==> 正在卸载 Windows 下的 hustnet CLI ..." -ForegroundColor Cyan

$DeletedDir = $null

# 1. 安全删除安装目录
if (Test-Path -LiteralPath $InstallDir) {
    # 解析为字面绝对路径（拒绝通配符），并做误删防护
    $Resolved = (Resolve-Path -LiteralPath $InstallDir).Path

    # 必须存在本工具生成的标记文件，否则拒绝递归删除
    $HasMarker = $false
    foreach ($name in @("hustnet.cmd", "hustnet.ps1")) {
        if (Test-Path -LiteralPath (Join-Path $Resolved $name)) { $HasMarker = $true; break }
    }
    if (-not $HasMarker) {
        throw "目录 '$Resolved' 未发现 hustnet.cmd / hustnet.ps1 安装标记，拒绝递归删除（防止误删）。"
    }

    # 拒绝磁盘根目录 / 用户主目录
    $Normalized = $Resolved.TrimEnd('\')
    $Root = [System.IO.Path]::GetPathRoot($Resolved).TrimEnd('\')
    if ($Normalized -eq $Root) {
        throw "拒绝删除磁盘根目录 '$Resolved'。"
    }
    if ($env:USERPROFILE -and $Normalized -ieq $env:USERPROFILE.TrimEnd('\')) {
        throw "拒绝删除用户主目录 '$Resolved'。"
    }

    Remove-Item -LiteralPath $Resolved -Recurse -Force
    $DeletedDir = $Resolved
    Write-Host "==> 已删除目录: $Resolved" -ForegroundColor Green
} else {
    Write-Host "提示: 未找到目录 $InstallDir，可能已删除。" -ForegroundColor Yellow
}

# 2. 从 Windows 用户级 PATH 环境变量中清理该路径
$PathEntry = if ($DeletedDir) { $DeletedDir } else { $InstallDir }
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not [string]::IsNullOrWhiteSpace($UserPath)) {
    $Paths = ($UserPath -split ";") | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and $_.TrimEnd('\') -ne $PathEntry.TrimEnd('\')
    }
    $NewPath = $Paths -join ";"
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    Write-Host "==> 已从当前用户的 PATH 环境变量中移除该路径。" -ForegroundColor Green
}

Write-Host "==> Windows 卸载完成，环境已恢复干净。" -ForegroundColor Green
