# PowerShell script for installing hustnet CLI on Windows
param (
    [string]$InstallDir = $(Join-Path $env:LOCALAPPDATA "Programs\hustnet")
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = (Resolve-Path "$ScriptDir\..").Path
$EntryFile = Join-Path $RepoDir "hustnet\bin\hustnet.ts"

# 覆盖前：若目标已存在且非本工具生成，先备份，避免误覆盖
function Backup-IfForeign([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $existing = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
    if ($existing -match "hustnet\.ts") { return }
    $backup = "$Path.bak.$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
    Copy-Item -LiteralPath $Path -Destination $backup -Force
    Write-Host "==> 已备份原有文件: $Path -> $backup" -ForegroundColor Yellow
}

Write-Host "==> 正在为 Windows 安装 hustnet CLI 到 $InstallDir ..." -ForegroundColor Cyan

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# 检查 Node.js
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Warning "未检测到 node 命令，请确保已安装 Node.js 22+ 并加入环境变量 PATH。"
}

# 1. 生成 CMD 包装脚本 (hustnet.cmd)
$CmdPath = Join-Path $InstallDir "hustnet.cmd"
$CmdContent = @"
@echo off
setlocal
node --experimental-strip-types "$EntryFile" %*
"@
Backup-IfForeign $CmdPath
[System.IO.File]::WriteAllText($CmdPath, $CmdContent, [System.Text.Encoding]::UTF8)

# 2. 生成 PowerShell 包装脚本 (hustnet.ps1)
$Ps1Path = Join-Path $InstallDir "hustnet.ps1"
$Ps1Content = @"
& node --experimental-strip-types "$EntryFile" @args
"@
Backup-IfForeign $Ps1Path
[System.IO.File]::WriteAllText($Ps1Path, $Ps1Content, [System.Text.Encoding]::UTF8)

Write-Host "==> 已生成执行文件：" -ForegroundColor Green
Write-Host "    $CmdPath"
Write-Host "    $Ps1Path"

# 检查并更新 Windows 用户级 PATH 环境变量
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$Paths = ($UserPath -split ";") | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

if ($Paths -notcontains $InstallDir) {
    Write-Host "正在将 $InstallDir 添加到用户 PATH 环境变量..." -ForegroundColor Cyan
    $NewPath = ($Paths + $InstallDir) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "==> 已成功写入用户 PATH！新打开的 CMD / PowerShell 窗口即可直接运行 'hustnet'。" -ForegroundColor Green
} else {
    Write-Host "==> 环境变量已就绪，当前可在终端中直接运行 'hustnet help' 或 'hustnet status'。" -ForegroundColor Green
}
