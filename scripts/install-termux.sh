#!/data/data/com.termux/files/usr/bin/bash
# LookatStudy Termux 一键安装/运行(安装优化照搬 KaijiBot 实测经验):
#   bash install-termux.sh            # 首次安装(镜像/依赖/下载/保活配置)+ 启动
#   bash ~/lookatstudy/start.sh       # 之后启动(也可直接开 Termux,bashrc 会自动拉起)
#   bash ~/lookatstudy/stop.sh        # 停止
#   bash ~/lookatstudy/status.sh      # 状态 + 访问链接
#   bash ~/lookatstudy/update.sh      # 更新便携包并重启
# 无 npm 依赖:便携包(server.cjs 单文件)从 GitHub Release 下载,中国网络走 ghproxy 回退链。
set -euo pipefail

PORT="${LOOKATSTUDY_PORT:-17890}"
APP_DIR="$HOME/lookatstudy"
DATA_DIR="$HOME/.lookatstudy"
GH_ASSET="https://github.com/Kaiji-Z/LookatStudy/releases/latest/download/lookatstudy-mobile.zip"
GH_VOICE="https://github.com/Kaiji-Z/LookatStudy/releases/latest/download/lookatstudy-termux-voice.tar.gz"
# 直连优先,失败再走代理前缀(镜像只做回退:KaijiBot 教训是镜像同步延迟会坏事,大头收益在 apt 的 TUNA)
DL_PREFIXES=("" "https://gh-proxy.com/" "https://ghproxy.net/" "https://ghfast.top/")

# npmmirror(阿里,自动同步 npm)解析包的 latest tarball 地址;空输出=未同步/网络失败
npm_tarball() {
  curl -sfL --connect-timeout 8 --max-time 20 "https://registry.npmmirror.com/$1/latest"     | sed -n 's/.*"tarball":"\([^"]*\)".*//p'
}

info() { printf '\033[1m[*]\033[0m %s\n' "$*"; }
ok()   { printf '\033[38;2;0;229;204m[✓]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[!]\033[0m %s\n' "$*"; }

# ── Termux 环境守卫 ──────────────────────────────────────────
[ -d /data/data/com.termux ] || { echo "此脚本必须在 Termux 里运行。"; exit 1; }

is_cn() {
  case "$(getprop persist.sys.timezone 2>/dev/null || echo "")" in
    Asia/Shanghai|Asia/Chongqing|Asia/Harbin|Asia/Urumqi|Asia/Kashgar|PRC|CTT) return 0 ;;
  esac
  return 1
}

have() { command -v "$1" >/dev/null 2>&1; }

node_major() {
  node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1 || echo 0
}

serve_pid() { pgrep -f "server.cjs --port $PORT" 2>/dev/null || true; }

refresh_url_file() {
  # serve-token 首启落盘后长期复用;url.txt 给「显示访问链接」命令用
  if [ -f "$DATA_DIR/serve-token" ]; then
    echo "http://127.0.0.1:$PORT/?token=$(cat "$DATA_DIR/serve-token")" > "$APP_DIR/url.txt"
    cat "$APP_DIR/url.txt"
  fi
}

start_service() {
  # pkill 无匹配返回非零,set -e 下会误杀脚本 —— 必须挂 || true(KaijiBot 踩坑)
  pkill -f "server.cjs --port $PORT" 2>/dev/null || true
  sleep 1
  termux-wake-lock 2>/dev/null || true
  # 语音引擎 .so 就位后由 $ORIGIN/LD_LIBRARY_PATH 双保险解析(路 3)
  export LD_LIBRARY_PATH="$APP_DIR/node_modules/sherpa-onnx-node${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  nohup node "$APP_DIR/server.cjs" --port "$PORT" --web "$APP_DIR/web" --data "$DATA_DIR" \
    >> "$APP_DIR/server.log" 2>&1 &
  sleep 3
  if [ -n "$(serve_pid)" ]; then
    ok "LookatStudy 已启动(端口 $PORT)"
    refresh_url_file
    info "浏览器打开上面的链接即可(带 token,只需这一次;之后直接开 Termux 或启动器即可)"
  else
    warn "服务可能没起来,查看日志: tail -20 $APP_DIR/server.log"
  fi
}

download_bundle() {
  mkdir -p "$APP_DIR"
  cd "$APP_DIR"
  info "下载便携包(约 5MB)..."
  # 主源:npm 镜像(npmmirror 同步 npm 发布,国内直连快;tgz 需剥 package/ 前缀)
  local tb
  tb=$(npm_tarball lookatstudy-mobile)
  if [ -n "$tb" ] && curl -fL --connect-timeout 10 --retry 2 -o mobile.tgz "$tb"; then
    tar -xzf mobile.tgz --strip-components=1
    rm -f mobile.tgz
    ok "便携包就位(npm 镜像): $APP_DIR"
    return 0
  fi
  info "npm 镜像未命中,回退 GitHub 直连+代理链..."
  local dl_ok=0 p=""
  for p in "${DL_PREFIXES[@]}"; do
    if curl -fL --connect-timeout 10 --retry 2 -o ls.zip "${p}${GH_ASSET}"; then
      dl_ok=1
      break
    fi
    info "${p:-GitHub 直连}失败,尝试下一个下载源..."
  done
  if [ "$dl_ok" != 1 ]; then
    echo "下载失败。请手动下载 $GH_ASSET 放到 $APP_DIR/ls.zip 后重跑本脚本。"
    exit 1
  fi
  unzip -o ls.zip
  rm -f ls.zip
  ok "便携包就位: $APP_DIR"
}

install_voice() {
  mkdir -p "$APP_DIR/node_modules"
  info "下载 Termux 语音引擎包(约 12MB)..."
  # 主源:npm 镜像(tgz 剥 package/ 前缀,解出 sherpa-onnx-node/ 目录)
  local tb
  tb=$(npm_tarball lookatstudy-termux-voice)
  if [ -n "$tb" ] && curl -fL --connect-timeout 10 --retry 2 -o voice.tgz "$tb"; then
    tar -xzf voice.tgz --strip-components=1 -C "$APP_DIR/node_modules"
    rm -f voice.tgz
    ok "语音引擎就位(npm 镜像): $APP_DIR/node_modules/sherpa-onnx-node"
    info "语音模型在应用内按需下载(设置 → 语音能力):朗读本地档约 430MB;听写建议云档(Groq/Azure),本地 Whisper 约 360MB~1GB"
    info "装完模型重启服务生效: bash ~/lookatstudy/start.sh"
    return 0
  fi
  info "npm 镜像未命中,回退 GitHub 直连+代理链..."
  local dl_ok=0 p=""
  for p in "${DL_PREFIXES[@]}"; do
    if curl -fL --connect-timeout 10 --retry 2 -o voice.tar.gz "${p}${GH_VOICE}"; then
      dl_ok=1
      break
    fi
    info "${p:-GitHub 直连}失败,尝试下一个下载源..."
  done
  if [ "$dl_ok" != 1 ]; then
    echo "语音引擎包下载失败(可稍后重跑本脚本,或跳过语音功能)。"
    rm -f voice.tar.gz
    return 1
  fi
  tar -xzf voice.tar.gz -C "$APP_DIR/node_modules"
  rm -f voice.tar.gz
  ok "语音引擎就位: $APP_DIR/node_modules/sherpa-onnx-node"
  info "语音模型(朗读约 430MB + 听写约 200MB)在应用内下载: 设置 → 语音能力"
  info "装完模型重启服务生效: bash ~/lookatstudy/start.sh"
}

# ── 1. 中国时区 → TUNA apt 镜像(默认源在中国极慢/不可达) ─────
# 用 apt-get 而非 pkg:pkg 包装器每次跑 select_mirror 全球测速 60+ 镜像,更慢
if is_cn; then
  echo "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main/ stable main" \
    > "$PREFIX/etc/apt/sources.list"
  info "检测到中国时区,apt 源切换到 TUNA 镜像"
else
  info "非中国时区,保持 Termux 默认源"
fi

# ── 2. 升级 + 依赖 ───────────────────────────────────────────
# 全新 Termux 不先 upgrade 直接装 Node 会 OpenSSL 链接错误(KaijiBot 实测 CRITICAL 坑)
export DEBIAN_FRONTEND=noninteractive
APT_OPTS="-y -o Dpkg::Options::=--force-confold"
info "升级 Termux 基础包(首次可能需要几分钟)..."
apt-get update $APT_OPTS || true
apt-get upgrade $APT_OPTS || true

info "安装 Node.js 与工具(已装的跳过)..."
have node || apt-get install $APT_OPTS nodejs-lts
have curl || apt-get install $APT_OPTS curl
have unzip || apt-get install $APT_OPTS unzip

MAJOR="$(node_major)"
if [ "${MAJOR:-0}" -lt 20 ]; then
  info "Node v${MAJOR} 过旧,升级 nodejs-lts..."
  apt-get install $APT_OPTS nodejs-lts
  MAJOR="$(node_major)"
  if [ "${MAJOR:-0}" -lt 20 ]; then
    echo "Node >= 20 安装失败,请手动执行: pkg install nodejs-lts"
    exit 1
  fi
fi
ok "Node v${MAJOR}(要求 >= 20)"

# ── 3. 便携包(已存在则跳过,更新走 update.sh) ────────────────
if [ -f "$APP_DIR/server.cjs" ]; then
  ok "便携包已存在(更新请运行: bash ~/lookatstudy/update.sh)"
else
  download_bundle
fi

# ── 4. 常用命令脚本 ──────────────────────────────────────────
cat > "$APP_DIR/start.sh" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
# 启动 LookatStudy(前台输出状态,服务本体后台常驻)
set -u
PORT="${PORT}"
APP_DIR="${APP_DIR}"
termux-wake-lock 2>/dev/null
pkill -f "server.cjs --port \$PORT" 2>/dev/null; sleep 1
export LD_LIBRARY_PATH="\$APP_DIR/node_modules/sherpa-onnx-node\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
nohup node "\$APP_DIR/server.cjs" --port "\$PORT" --web "\$APP_DIR/web" --data "${DATA_DIR}" >> "\$APP_DIR/server.log" 2>&1 &
sleep 3
if pgrep -f "server.cjs --port \$PORT" >/dev/null 2>&1; then
  echo "[✓] 已启动(端口 \$PORT)"
  [ -f "${DATA_DIR}/serve-token" ] && echo "http://127.0.0.1:\$PORT/?token=\$(cat ${DATA_DIR}/serve-token)" | tee "\$APP_DIR/url.txt"
else
  echo "[!] 没起来,看日志: tail -20 \$APP_DIR/server.log"
fi
EOS

cat > "$APP_DIR/stop.sh" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
# 停止 LookatStudy
pkill -f "server.cjs --port ${PORT}" 2>/dev/null && echo "[✓] 已停止" || echo "服务本来就没在运行"
termux-wake-unlock 2>/dev/null
exit 0
EOS

cat > "$APP_DIR/status.sh" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
# 状态 + 访问链接
PORT="${PORT}"
if pgrep -f "server.cjs --port \$PORT" >/dev/null 2>&1; then
  echo "[✓] 运行中(端口 \$PORT,PID \$(pgrep -f "server.cjs --port \$PORT" | tr '\n' ' '))"
  code=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:\$PORT/" 2>/dev/null || echo 000)
  echo "    HTTP \$code"
else
  echo "[✗] 未运行。启动: bash ~/lookatstudy/start.sh"
fi
[ -f "${DATA_DIR}/serve-token" ] && echo "访问链接: http://127.0.0.1:\$PORT/?token=\$(cat ${DATA_DIR}/serve-token)"
exit 0
EOS

cat > "$APP_DIR/update.sh" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
# 更新便携包并重启(下载源带回退链,与 install-termux.sh 同款)
set -euo pipefail
APP_DIR="${APP_DIR}"
GH_ASSET="${GH_ASSET}"
cd "\$APP_DIR"
echo "==> 停止旧服务..."
pkill -f "server.cjs --port ${PORT}" 2>/dev/null || true
sleep 1
echo "==> 下载最新便携包..."
dl_ok=0
for p in "" "https://gh-proxy.com/" "https://ghproxy.net/" "https://ghfast.top/"; do
  if curl -fL --connect-timeout 10 --retry 2 -o ls.zip "\${p}\${GH_ASSET}"; then dl_ok=1; break; fi
  echo "    \${p:-直连}失败,换下一个源..."
done
[ "\$dl_ok" = 1 ] || { echo "下载失败,保持原版本。"; exit 1; }
unzip -o ls.zip && rm -f ls.zip
echo "==> 重启..."
exec bash "\$APP_DIR/start.sh"
EOS

chmod 755 "$APP_DIR"/{start,stop,status,update}.sh
ok "常用脚本就位: ~/lookatstudy/{start,stop,status,update}.sh"

# ── 5. 自启双保险:Termux:Boot(开机)+ .bashrc(开 Termux 即拉起) ──
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/start-lookatstudy.sh" <<EOS
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null
LD_LIBRARY_PATH="${APP_DIR}/node_modules/sherpa-onnx-node:${LD_LIBRARY_PATH:-}" nohup node ${APP_DIR}/server.cjs --port ${PORT} --web ${APP_DIR}/web --data ${DATA_DIR} >> ${APP_DIR}/server.log 2>&1 &
EOS
chmod 755 "$HOME/.termux/boot/start-lookatstudy.sh"

BASHRC_MARKER="# >>> lookatstudy autostart >>>"
if ! grep -q "$BASHRC_MARKER" "$HOME/.bashrc" 2>/dev/null; then
  cat >> "$HOME/.bashrc" <<EOS
${BASHRC_MARKER}
if ! pgrep -f "server.cjs --port ${PORT}" >/dev/null 2>&1; then
  termux-wake-lock 2>/dev/null
  LD_LIBRARY_PATH="${APP_DIR}/node_modules/sherpa-onnx-node:${LD_LIBRARY_PATH:-}" nohup node ${APP_DIR}/server.cjs --port ${PORT} --web ${APP_DIR}/web --data ${DATA_DIR} >> ${APP_DIR}/server.log 2>&1 &
  echo "LookatStudy 已自动启动 (http://127.0.0.1:${PORT})"
fi
# <<< lookatstudy autostart <<<
EOS
  ok ".bashrc 自启已配置(以后打开 Termux = 服务自动拉起)"
else
  ok ".bashrc 自启已存在"
fi

if pm list packages 2>/dev/null | grep -q "com.termux.boot"; then
  ok "Termux:Boot 已安装(手机重启后会自动启动)"
else
  warn "未装 Termux:Boot —— 手机重启后不会自动启动(打开 Termux 才会启动)。"
  warn "安装(可选): https://f-droid.org/packages/com.termux.boot/ 装完打开一次授权"
fi

# ── 6. 电池优化:自动弹系统白名单对话框 + 按厂商给手动路径 ────
am start -a android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS -d package:com.termux >/dev/null 2>&1 \
  && ok "已打开电池优化设置,请点「允许」" \
  || warn "无法自动打开电池设置,请按下面厂商指引手动设置"

case "$(getprop ro.product.manufacturer 2>/dev/null | tr '[:upper:]' '[:lower:]')" in
  xiaomi|redmi)
    echo "    设置 → 应用管理 → Termux → 省电策略 → 无限制;并给 Termux 开自启动权限"
    ;;
  samsung)
    echo "    设置 → 应用程序 → Termux → 电池 → 不受限制;关闭「使未使用的应用进入休眠」"
    ;;
  huawei|honor)
    echo "    设置 → 电池 → 应用启动管理 → Termux → 手动管理,三个开关全开"
    ;;
  vivo)
    echo "    i 管家 → 应用管理 → 自启动 → 允许 Termux;后台高耗电允许 Termux"
    ;;
  oppo|oneplus|realme)
    echo "    设置 → 电池 → Termux → 允许自启动与后台运行"
    ;;
  *)
    echo "    设置 → 应用 → Termux → 电池 → 不受限制/不优化"
    ;;
esac

# ── 6.5 语音引擎(Termux 专属交叉编译包,默认安装) ────────────
# 引擎包 ~12MB 一次到位(相对 Node+系统升级的体量可忽略;语音朗读/听写默认能力)。
# 全程零交互:失败不阻断安装(朗读在线档/听写云档不依赖本地引擎),重跑安装命令即补装。
# 兼容旧写法:--voice 参数仍被接受(现为默认,传不传一样)。
install_voice || true

# ── 7. 启动 + 打印访问链接 ───────────────────────────────────
info "启动 LookatStudy..."
start_service
ok "完成。日常使用:打开启动器点「打开 LookatStudy」,或浏览器访问 http://127.0.0.1:$PORT"
echo ''
info '语音朗读/语音输入(v0.12):桌面端功能。Termux 是 bionic libc,sherpa-onnx 原生引擎暂无'
info '预编译包,手机端自动优雅降级(界面不显示语音入口或提示平台不支持),不影响其他功能。' 
