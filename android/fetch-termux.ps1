# 取 Termux APK 放进 res/raw(Windows 本地构建用;CI 用 fetch-termux.sh)
$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path "$dir\app\src\main\res\raw" | Out-Null
Invoke-WebRequest -Uri "https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3+github-debug_arm64-v8a.apk" -OutFile "$dir\app\src\main\res\raw\termux.apk"
Get-Item "$dir\app\src\main\res\raw\termux.apk"
