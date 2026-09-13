/**
 * verify-xss-hardening —— XSS 链斩断纪律套件(2026-09-13 安全审计 · WP2)。
 *
 * 审计链路:恶意课程内容 → mermaid loose(label HTML 进 SVG)→ dangerouslySetInnerHTML
 * → CSP 'unsafe-inline' 放行事件属性 → 脚本拿到 window.api(全权 IPC)→ P0 级后果。
 * 任一环节斩断即断链,本套件把四个环节全部锁死:
 *   T1  isAllowedExternalUrl 纯函数:ms-msdt:/search-ms:/file:/javascript: 等拒,http(s)/mailto 放
 *   T2  CSP:index.html 与 pet.html 的 script-src 无 'unsafe-inline'(style-src 保留),
 *       base-uri/form-action 已声明
 *   T3  FOUC 脚本外联化:index.html 无无-src 内联 <script>,引用 ./fouc.js 且文件在 public
 *   T4  mermaid securityLevel 必须为 strict(源级)
 *   T5  主窗与桌宠窗都有 setWindowOpenHandler + will-navigate,且 openExternal 前过白名单
 *   T6  本套件已注册 verify:core
 *
 * 运行:npx tsx scripts/verify-xss-hardening.mjs(纯 node,不依赖 Electron)
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.error(`✗ ${name}${detail ? `: ${detail}` : ""}`);
    fail++;
  }
}

const { isAllowedExternalUrl } = await import("../src/main/lib/external-url.ts");

// ── T1 外链协议白名单纯函数 ──
check("T1 放行 https/http/mailto", isAllowedExternalUrl("https://example.com") && isAllowedExternalUrl("http://example.com") && isAllowedExternalUrl("mailto:a@b.c"));
check("T1 拒绝 Windows 危险协议处理器", !isAllowedExternalUrl("ms-msdt:abc") && !isAllowedExternalUrl("search-ms:crumb=q") && !isAllowedExternalUrl("smb://host/share"));
check("T1 拒绝 file/javascript/chrome", !isAllowedExternalUrl("file:///C:/x") && !isAllowedExternalUrl("javascript:alert(1)") && !isAllowedExternalUrl("chrome://settings"));
check("T1 拒绝畸形 URL", !isAllowedExternalUrl("not a url") && !isAllowedExternalUrl(""));

// ── T2 CSP 收紧 ──
for (const f of ["src/renderer/index.html", "src/renderer/pet.html"]) {
  const html = read(f);
  const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? "";
  const scriptSrc = /script-src [^;]+/.exec(csp)?.[0] ?? "";
  check(`T2 ${f} script-src 无 unsafe-inline`, scriptSrc.includes("'self'") && !scriptSrc.includes("'unsafe-inline'"), scriptSrc);
  check(`T2 ${f} 声明 base-uri/form-action`, csp.includes("base-uri 'none'") && csp.includes("form-action 'none'"));
  // style-src 的 unsafe-inline 是有意保留(mermaid/katex 运行时注入 <style> 依赖,无脚本执行原语)
  check(`T2 ${f} style-src 保留(有据可查的取舍)`, csp.includes("style-src 'self' 'unsafe-inline'"));
}

// ── T3 FOUC 外联化 ──
{
  const html = read("src/renderer/index.html");
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g)];
  check("T3 index.html 无无-src 内联脚本", inlineScripts.length === 0, `发现 ${inlineScripts.length} 处`);
  check("T3 index.html 引用 ./fouc.js", html.includes('<script src="./fouc.js"></script>'));
  check("T3 public/fouc.js 存在且保留主题逻辑", existsSync(join(ROOT, "src/renderer/public/fouc.js")) && read("src/renderer/public/fouc.js").includes("lookatstudy-theme"));
}

// ── T4 mermaid strict ──
{
  const src = read("src/renderer/lib/lazy-mermaid.ts");
  check("T4 mermaid securityLevel 为 strict", /securityLevel:\s*"strict"/.test(src) && !/securityLevel:\s*"loose"/.test(src));
}

// ── T5 双窗导航防线 ──
{
  const mainSrc = read("src/main/index.ts");
  const petSrc = read("src/main/pet-window.ts");
  check("T5 主窗 setWindowOpenHandler 过白名单", mainSrc.includes("setWindowOpenHandler") && mainSrc.includes("isAllowedExternalUrl"));
  check("T5 主窗 will-navigate 过白名单", /will-navigate[\s\S]{0,600}isAllowedExternalUrl/.test(mainSrc));
  check("T5 桌宠窗补齐 setWindowOpenHandler", petSrc.includes("setWindowOpenHandler") && petSrc.includes("isAllowedExternalUrl"));
  check("T5 桌宠窗补齐 will-navigate", petSrc.includes("will-navigate"));
}

// ── T6 注册 ──
{
  const pkg = JSON.parse(read("package.json"));
  check("T6 本套件已注册 verify:core", pkg.scripts["verify:core"].includes("verify-xss-hardening"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
