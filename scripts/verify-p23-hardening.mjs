/**
 * verify-p23-hardening —— P2/P3 批量加固纪律套件(2026-09-13 安全审计 · WP7)。
 *
 *   T1  unzipGuardFilter 行为(真 zip 往返):超声明总量/超条目数的条目不解压
 *   T2  downloadToBuffer 流式截断行为(fetch 桩 + 大 ReadableStream):超限即断,不整读
 *   T3  headingsSimilar 行为:同源标题过/错位标题截/空标题保守放行
 *   T4  sanitizeTranslatedMarkdown 行为:on* 事件属性与 javascript: 协议被剥
 *   T5  静态杂项:setWebToken 真清 URL/双处 urlTransform 恢复默认/escapeHtml 引号/
 *       LIKE ESCAPE/serve 恒时比较/dsh 备份结构化错误/fmp4 空 box 防线/
 *       course:delete 吞错改日志/图片 10MB 上限
 *   T6  本套件已注册 verify:core
 *
 * 运行:npx tsx scripts/verify-p23-hardening.mjs(纯 node,不依赖 Electron)
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
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

const { unzipGuardFilter } = await import("../src/main/services/pure/entry-guard.ts");
const { downloadToBuffer, sanitizeTranslatedMarkdown } = await import("../src/main/services/pure/repo-fetcher.ts");
const { headingsSimilar } = await import("../src/main/services/import-pipeline.ts");

// ── T1 zip-bomb 滤网行为 ──
{
  const { unzipSync } = await import("fflate");
  const big = new Uint8Array(64 * 1024); // 64KB/条
  const zip = zipSync({ "a.bin": big, "b.bin": big, "c.bin": big });
  const full = unzipSync(zip);
  check("T1 基线:无滤网时 3 条全解", Object.keys(full).length === 3);
  const limited = unzipSync(zip, { filter: unzipGuardFilter(128 * 1024, 100) }); // 限 128KB
  check("T1 超 2×64KB 后第 3 条不解压", Object.keys(limited).length === 2, `实际 ${Object.keys(limited).length}`);
  const limitedN = unzipSync(zip, { filter: unzipGuardFilter(10 * 1024 ** 3, 2) }); // 限 2 条
  check("T1 超条目数后截断", Object.keys(limitedN).length === 2);
}

// ── T2 downloadToBuffer 流式截断行为 ──
{
  const chunk = new Uint8Array(64 * 1024);
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < 40; i++) c.enqueue(chunk); // 2.5MB,上限 1MB
      c.close();
    },
  });
  const fetchStub = async () => new Response(stream, { status: 200 });
  let threw = null;
  try {
    await downloadToBuffer("https://x.example/big", fetchStub, { maxBytes: 1024 * 1024 });
  } catch (e) {
    threw = e;
  }
  check("T2 超限即断(不再整读后检查)", threw !== null && /上限/.test(threw.message), threw?.message ?? "未抛");
  // 正常小下载不受影响
  const okBuf = await downloadToBuffer("https://x.example/small", async () => new Response("hello", { status: 200 }));
  check("T2 正常下载完整返回", okBuf.toString() === "hello");
}

// ── T3 翻译标题相似度 ──
{
  check("T3 同源标题(中英对照)通过", headingsSimilar("Getting Started", "Getting Started 入门指南"));
  check("T3 完全错位标题被截", !headingsSimilar("Database Indexes", "Web Security 基础与最佳实践大全"));
  check("T3 空标题保守放行(旧行为)", headingsSimilar("", "随便什么") && headingsSimilar("x", ""));
}

// ── T4 翻译粗滤黑名单扩展 ──
{
  const dirty = '<p onclick="evil()">x</p><img src=x onerror=alert(1)><a href="javascript:evil()">l</a><video><source onerror=x></video>';
  const clean = sanitizeTranslatedMarkdown(dirty);
  check("T4 on* 事件属性被剥", !/onerror|onclick/.test(clean), clean);
  check("T4 javascript: 协议被中和", !/javascript:/.test(clean), clean);
}

// ── T5 静态杂项 ──
{
  const apiWeb = read("src/renderer/lib/api-web.ts");
  check("T5 setWebToken 真清 URL(replaceState+delete)", apiWeb.includes('url.searchParams.delete("token")') && apiWeb.includes("history.replaceState"));
  const cs = read("src/renderer/components/ChatStream.tsx");
  const nb = read("src/renderer/components/NotebookPanel.tsx");
  check("T5 双处 urlTransform 恢复默认", !cs.includes("urlTransform") && !nb.includes("urlTransform"));
  const shiki = read("src/renderer/lib/lazy-shiki.ts");
  check("T5 escapeHtml 补引号转义", shiki.includes('&quot;') && shiki.includes("&#39;"));
  const search = read("src/main/services/search-service.ts");
  check("T5 LIKE 带 ESCAPE 子句并转义通配符", search.includes("ESCAPE '\\\\'") && search.includes("const esc = (t: string)"));
  const serve = read("src/main/serve/server.ts");
  check("T5 serve token 恒时比较", serve.includes("timingSafeEqual"));
  const dsh = read("src/main/services/dsh-import-service.ts");
  check("T5 dsh 备份失败结构化中止", dsh.includes("备份库文件失败，已中止"));
  const fmp4 = read("src/main/services/pure/fmp4-to-adts.ts");
  check("T5 fmp4 空 box 防线", fmp4.includes("v.byteLength < 8) continue"));
  const ipc = read("src/main/ipc/index.ts");
  check("T5 course:delete 吞错改日志", ipc.includes("[course:delete] 级联删除步骤失败"));
  const repo = read("src/main/services/pure/repo-fetcher.ts");
  check("T5 图片下载 10MB 上限", repo.includes("maxBytes: 10 * 1024 * 1024"));
}

// ── T6 注册 ──
{
  const pkg = JSON.parse(read("package.json"));
  check("T6 本套件已注册 verify:core", pkg.scripts["verify:core"].includes("verify-p23-hardening"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
