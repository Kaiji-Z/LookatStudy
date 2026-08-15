/**
 * 聊天附件的"收口纯函数" —— 渲染层选文件时校验 + main 层装配消息时共用。
 *
 * 附件两种命运(见 CHANGELOG v0.10):
 *   - image:走 vision(本轮 LLM file-part 注入 + 落盘 userData/attachments 供历史缩略图)
 *   - text:读出正文内联进 user content(持久化 + LLM 历史天然可见,不落盘)
 *
 * 纯函数、零依赖:渲染层与 main 共用同一套规则,校验不会两端漂移。
 */

/** 附件上限(与参考 DeepSeek Chat 语义一致:整批拒绝,不部分收)。 */
export const ATTACHMENT_LIMITS = {
  /** 每条消息最多附件数(图片+文本合计)。 */
  maxPerMessage: 4,
  /** 单张图片上限(5MB)。 */
  maxImageBytes: 5 * 1024 * 1024,
  /** 单个文本文件上限(256KB —— 正文会内联进 content,太大直接爆上下文)。 */
  maxTextBytes: 256 * 1024,
} as const;

/** 判定为"文本附件"的扩展名(代码/配置/文档)。不在表内且非图片 → unsupported。 */
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "rst", "org", "adoc", "log", "csv", "tsv", "json", "yaml", "yml", "toml", "ini", "env",
  "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "rb", "sh",
  "bash", "zsh", "ps1", "sql", "html", "htm", "css", "scss", "vue", "svelte", "kt", "swift", "php", "lua", "r",
  "dart", "scala", "clj", "ex", "exs", "erl", "hs", "ml", "jl", "m", "mm", "pl", "vb", "bat", "dockerfile",
]);

/** 文件名 → 小写扩展名(无扩展名返回 "")。 */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

export type AttachmentKind = "image" | "text";

/** 单个已选文件的判定结果。ok=收下(kind 定命运);error=拒绝(原因 i18n key + 插值)。 */
export type AttachmentCheck =
  | { ok: true; kind: AttachmentKind }
  | { ok: false; reason: "unsupported" | "tooLargeImage" | "tooLargeText" };

/**
 * 校验一个用户选中的文件(mime 可能缺省,靠扩展名兜底)。
 * 判定顺序:先定 kind(图片 mime 或图片扩展名 → image;文本扩展名 → text;否则 unsupported),
 * 再按 kind 查大小上限 —— 类型错比超限更根本,报错先报类型。
 */
export function checkAttachmentFile(name: string, mime: string, size: number): AttachmentCheck {
  const isImage = (mime && mime.startsWith("image/")) || ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(fileExtension(name));
  if (isImage) {
    return size > ATTACHMENT_LIMITS.maxImageBytes
      ? { ok: false, reason: "tooLargeImage" }
      : { ok: true, kind: "image" };
  }
  if (TEXT_EXTENSIONS.has(fileExtension(name))) {
    return size > ATTACHMENT_LIMITS.maxTextBytes
      ? { ok: false, reason: "tooLargeText" }
      : { ok: true, kind: "text" };
  }
  return { ok: false, reason: "unsupported" };
}

/** 文件名 → markdown 代码围栏语言标注(foo.PY → python;未知 → 无标注的裸围栏)。 */
const FENCE_LANG: Record<string, string> = {
  py: "python", js: "javascript", mjs: "javascript", cjs: "javascript", ts: "typescript", tsx: "tsx",
  jsx: "jsx", go: "go", rs: "rust", java: "java", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp",
  rb: "ruby", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell", sql: "sql", html: "html",
  css: "css", scss: "scss", json: "json", yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown",
  csv: "csv", lua: "lua", r: "r", php: "php", kt: "kotlin", swift: "swift", vue: "vue", svelte: "svelte",
};

/**
 * 把文本附件内联进 user content(LLM 与持久化看到的最终正文)。
 * 每个附件一段,```` 四反引号围栏防内容里的 ``` 提前闭合。
 */
export function buildContentWithTextAttachments(
  message: string,
  texts: Array<{ name: string; text: string }>,
): string {
  if (texts.length === 0) return message;
  const blocks = texts.map((tx) => {
    const lang = FENCE_LANG[fileExtension(tx.name)] ?? "";
    return `\n\n---\n附件 ${tx.name}:\n\`\`\`\`${lang}\n${tx.text}\n\`\`\`\``;
  });
  return `${message}${blocks.join("")}`;
}
