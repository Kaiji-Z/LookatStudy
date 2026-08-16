#!/usr/bin/env bash
# 取 Termux APK 放进 res/raw(CI 也会跑这步;不入库,GPL 独立作品)
# 来源: github.com/termux/termux-app 官方 release(GPL-3.0, 源码同地址)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p app/src/main/res/raw
curl -fL -o app/src/main/res/raw/termux.apk \
  "https://github.com/termux/termux-app/releases/download/v0.118.3/termux-app_v0.118.3+github-debug_arm64-v8a.apk"
ls -la app/src/main/res/raw/termux.apk
