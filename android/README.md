# LookatStudy 手机引导器（Android launcher APK）

这不是应用本体。LookatStudy 的手机形态 = Termux 里跑 `server.cjs`（Node 便携包，
零 npm install）+ 手机浏览器访问 `http://127.0.0.1:17890`。这个 APK 只做引导：

1. **安装 Termux** —— 内置 `termux.apk`（构建时下载进 `res/raw/`），一键拉起系统安装器。
2. **复制安装命令并打开 Termux** —— 一行命令 `curl 安装脚本 | bash`（直连失败自动走
   ghproxy）。安装脚本（仓库 `scripts/install-termux.sh`，随 Release 单独发布）做全部事情：
   - 中国时区自动切 TUNA apt 镜像（`getprop persist.sys.timezone` 判定；用 apt-get 而非
     pkg，绕过 pkg 的全球镜像测速）；非中国时区保持默认源
   - `apt upgrade` 先行（全新 Termux 不升级直接装 Node 会 OpenSSL 链接错误）+ 依赖
     按需检测安装（nodejs-lts / curl / unzip，已装跳过）+ Node >= 20 版本验证
   - 便携包下载回退链：GitHub 直连 → gh-proxy.com → ghproxy.net → ghfast.top（实测可用）
   - 落盘 `~/lookatstudy/{start,stop,status,update}.sh` 四个常用脚本
   - 自启双保险：`~/.termux/boot/`（需 Termux:Boot）+ `.bashrc` 幂等块（开 Termux 即
     自动拉起，无需 Termux:Boot）
   - 电池优化：自动弹系统白名单对话框 + 按厂商（小米/三星/华为/vivo/oppo）给手动路径
3. **打开 LookatStudy** —— Custom Tab 打开 `http://127.0.0.1:17890/`；首次输入启动日志
   打印的 token（网页端令牌门），之后长期有效（token 落盘复用）。
4. **常用操作** —— 命令卡片屏（状态/启动/停止/更新/日志/访问链接/电池白名单/
   Termux:Boot），点击复制命令并跳 Termux 粘贴执行。

以上安装链路优化照搬 [KaijiBot](https://github.com/Kaiji-Z/kaijibot) 在真实手机上踩坑
沉淀的经验（镜像选择、bash `set -e` 陷阱、进程查找、保活三板斧等）。

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
`LookatStudy-launcher.apk` + `lookatstudy-mobile.zip` + `install-termux.sh`，
有 `release_tag` 时自动挂到对应 Release。
