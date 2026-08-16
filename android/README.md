# LookatStudy 手机引导器（Android launcher APK）

这不是应用本体。LookatStudy 的手机形态 = Termux 里跑 `server.cjs`（Node 便携包，
零 npm install）+ 手机浏览器访问 `http://127.0.0.1:17890`。这个 APK 只做引导：

1. **安装 Termux** —— 内置 `termux.apk`（构建时下载进 `res/raw/`），一键拉起系统安装器。
2. **复制安装命令并打开 Termux** —— 命令会装 curl/unzip，从 GitHub Release 下载
   `lookatstudy-mobile.zip`，解压后执行 `install-termux.sh`（装 Node + wake-lock + 启动服务）。
3. **打开 LookatStudy** —— Custom Tab 打开 `http://127.0.0.1:17890/`；首次输入启动日志
   打印的 token（网页端令牌门），之后长期有效（token 落盘复用）。

## 本地构建

Termux APK 不入库（GPL 独立作品 + 体积），构建前先取（CI 会自动做）：

```bash
# Linux / macOS / Termux
bash fetch-termux.sh

# Windows (PowerShell)
powershell -File fetch-termux.ps1
```

然后：

```bash
./gradlew assembleRelease
# 产物: app/build/outputs/apk/release/app-release.apk (debug 签名,可直接侧载)
```

需要 JDK 17 + Android SDK 34。

## CI

`.github/workflows/android-build.yml`：tag `v*` 或手动 dispatch 时构建，产物为
`LookatStudy-launcher.apk` + `lookatstudy-mobile.zip`，有 `release_tag` 时自动挂到对应 Release。
