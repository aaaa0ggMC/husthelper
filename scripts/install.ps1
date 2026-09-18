# PowerShell script for installing hustnet CLI on Windows
param (
    [string]$InstallDir = "$HOME\.local\bin"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = (Resolve-Path "$ScriptDir\..").Path
$EntryFile = Join-Path $RepoDir "examples\net_cli.ts"

Write-Host "==> 正在为 Windows 安装 hustnet CLI 到 $InstallDir ..." -ForegroundColor Cyan

if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# 检查 Node.js
if (-not (Get-Command "node" -ErrorAction SilentlyContinue)) {
    Write-Warning "未检测到 node 命令，请确保已安装 Node.js 22+ 并加入系统环境变量 PATH。"
}

# 1. 生成 CMD 包装器 (hustnet.cmd)
$CmdPath = Join-Path $InstallDir "hustnet.cmd"
$CmdContent = @"
@echo off
setlocal
set "REPO_DIR=$RepoDir"
node --experimental-strip-types "%REPO_DIR%\examples\net_cli.ts" %*
"@
[System.IO.File]::WriteAllText($CmdPath, $CmdContent, [System.Text.Encoding]::UTF8)

# 2. 生成 PowerShell 脚本包装器 (hustnet.ps1)
$Ps1Path = Join-Path $InstallDir "hustnet.ps1"
$Ps1Content = @"
`$RepoDir = "$RepoDir"
node --experimental-strip-types "`$RepoDir\examples\net_cli.ts" @args
"@
[System.IO.File]::WriteAllText($Ps1Path, $Ps1Content, [System.Text.Encoding]::UTF8)

Write-Host "==> 安装成功：" -ForegroundColor Green
Write-Host "    $CmdPath"
Write-Host "    $Ps1Path"

# 检查 PATH 环境变量
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$Paths = $UserPath -split ";"
if ($Paths -notcontains $InstallDir -and $Paths -notcontains "$InstallDir\") {
    Write-Host "`n提示: $InstallDir 尚未包含在当前用户的 PATH 环境变量中。" -ForegroundColor Yellow
    Write-Host "正在自动将该目录添加到用户 PATH..." -ForegroundColor Cyan
    $NewPath = if ([string]::IsNullOrWhiteSpace($UserPath)) { $InstallDir } else { "$UserPath;$InstallDir" }
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    $env:Path = "$env:Path;$InstallDir"
    Write-Host "已成功添加到用户 PATH。新打开的终端窗口即可直接执行 'hustnet' 命令！" -ForegroundColor Green
} else {
    Write-Host "已确认 $InstallDir 在系统 PATH 中，可直接在终端中运行 'hustnet help' 或 'hustnet status'。" -ForegroundColor Green
}
