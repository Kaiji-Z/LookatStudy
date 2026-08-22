/**
 * lazy-shiki —— shiki 语法高亮懒加载单例(v0.21)。
 *
 * 全应用代码高亮的唯一入口:讲解区/对话流代码块(highlightCodeBlock,双主题)
 * + 代码逐段讲解(highlightLines,固定深底面板单主题)。
 *
 * 设计决策:
 * - **细粒度按需**:core + JS 正则引擎 + 两主题一个懒 chunk;每个语法是独立动态
 *   import(各自小 chunk),只拉精选的 ~35 门常用语言——不进 shiki 全家桶
 *   (bundle/web 会把 200+ 语法全部打进构建)。
 * - **createJavaScriptRegexEngine**(forgiving):纯 JS 引擎,零 WASM——不碰
 *   CSP connect-src/资源加载,Electron 渲染层零配置可用。
 * - **双主题零闪烁**:markdown 代码块走 themes{light,dark} + defaultColor:'dark'
 *   ——内联色=暗色(应用默认主题),亮色值挂在 --shiki-light 变量上,html.light
 *   时 CSS 翻转(index.css .md-shiki 块)。切主题不重跑高亮、无重渲染闪烁。
 * - **信任模型同 KaTeX(v0.19 先例)**:shiki HTML 在渲染层由"已净化的纯文本"
 *   生成,自带 HTML 转义,不经 rehype-sanitize——输入永远是代码文本本身,
 *   XSS 面不扩大。sanitize schema 零改动。
 * - 未知语言/加载失败 → null,调用方回退现有纯文本 <pre>(绝不炸卡片)。
 */
import type { HighlighterCore, ThemedToken } from "shiki/core";

/** 精选语法表:应用导入支持的 30+ 代码类型 + AI 对话高频语言。 */
const LANG_MODULES: Record<string, () => Promise<{ default: unknown }>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  makefile: () => import("shiki/langs/makefile.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  latex: () => import("shiki/langs/latex.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
};

/** 围栏语言别名归一(```js / ```py 等常见写法)。 */
const LANG_ALIASES: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript",
  py: "python", python3: "python",
  rb: "ruby",
  golang: "go",
  rs: "rust",
  cs: "csharp",
  kt: "kotlin",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", shell: "shellscript", console: "shellscript",
  yml: "yaml",
  md: "markdown", gfm: "markdown",
  docker: "dockerfile",
  tex: "latex",
  plaintext: "", txt: "", text: "",
};

/** 未知/明确纯文本语言 → null(回退纯文本渲染)。 */
export function normalizeLang(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (key in LANG_ALIASES) return LANG_ALIASES[key] || null;
  return key in LANG_MODULES ? key : null;
}

let corePromise: Promise<HighlighterCore> | null = null;
/** 已加载语法缓存:同一语言只 loadLanguage 一次。 */
const loadedLangs = new Set<string>();

function getCore(): Promise<HighlighterCore> {
  if (!corePromise) {
    corePromise = (async () => {
      const [coreMod, engineMod, darkTheme, lightTheme] = await Promise.all([
        import("shiki/core"),
        import("shiki/engine/javascript"),
        import("shiki/themes/github-dark.mjs"),
        import("shiki/themes/github-light.mjs"),
      ]);
      return coreMod.createHighlighterCore({
        themes: [darkTheme.default, lightTheme.default],
        langs: [],
        engine: engineMod.createJavaScriptRegexEngine({ forgiving: true }),
      });
    })();
    corePromise.catch(() => {
      // 初始化失败不缓存坏 promise:下次调用重试(调用方已有 null 回退)
      corePromise = null;
    });
  }
  return corePromise;
}

async function ensureLang(lang: string): Promise<string | null> {
  const canonical = normalizeLang(lang);
  if (!canonical) return null;
  if (loadedLangs.has(canonical)) return canonical;
  const loader = LANG_MODULES[canonical];
  if (!loader) return null;
  const core = await getCore();
  const mod = await loader();
  // loadLanguage 变参 + 自解模块壳(.default 单注册或数组都收);必须 await——
  // 注册走微任务链,不等待的话紧随的 codeToHtml 会抢在注册完成前查询(实测踩过)
  await core.loadLanguage(mod as Parameters<HighlighterCore["loadLanguage"]>[0]);
  loadedLangs.add(canonical);
  return canonical;
}

/**
 * markdown 代码块高亮(双主题):返回完整 <pre class="shiki">…</pre> HTML,
 * 内联色=github-dark(应用默认),亮色在 --shiki-light 变量由 CSS 翻转。
 * 未就绪语言/失败 → null(调用方回退纯文本)。
 */
export async function highlightCodeBlock(code: string, lang: string): Promise<string | null> {
  try {
    const canonical = await ensureLang(lang);
    if (!canonical) return null;
    const core = await getCore();
    return core.codeToHtml(code, {
      lang: canonical,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: "dark",
    });
  } catch {
    return null;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * 逐行 token 高亮(代码逐段讲解用):每行返回内联 span 序列的 HTML 片段,
 * 单主题 github-dark —— 该面板固定深底(neutral-950),不随应用主题翻转。
 * 行数组与 code.split("\n") 一一对应;未知语言/失败 → null。
 */
export async function highlightLines(code: string, lang: string): Promise<string[] | null> {
  try {
    const canonical = await ensureLang(lang);
    if (!canonical) return null;
    const core = await getCore();
    const res = core.codeToTokens(code, { lang: canonical, theme: "github-dark" });
    return res.tokens.map((line: ThemedToken[]) =>
      line.map((tok) => `<span style="color:${tok.color}">${escapeHtml(tok.content)}</span>`).join(""),
    );
  } catch {
    return null;
  }
}
