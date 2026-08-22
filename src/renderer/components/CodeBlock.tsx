/**
 * CodeBlock —— markdown 代码块渲染(v0.21 从 ChatStream 抽出共享 + shiki 升级)。
 *
 * 讲解区(NotebookPanel)与对话流(ChatStream)共用:语言标签 + 一键复制 +
 * shiki 语法高亮(懒加载;引擎就绪前/未知语言回退原纯文本 <pre>,布局不跳)。
 *
 * shiki HTML 在渲染层生成:输入是 react-markdown 已净化的代码文本,shiki 自带
 * 转义,不经 rehype-sanitize —— 与 KaTeX(v0.19)同一信任模型,sanitize 零改动。
 */
import { useEffect, useState, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { useLang } from "../lib/i18n.js";
import { highlightCodeBlock } from "../lib/lazy-shiki.js";

/** 从 pre 的子级 <code> 里提语言与代码文本(children 可能是 string 或数组)。 */
function extractCode(children: ReactNode): { lang: string; text: string } {
  const child = Array.isArray(children) ? children[0] : children;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const childProps: any = (child as ReactElement)?.props ?? {};
  const langMatch = /language-(\w+)/.exec(childProps.className ?? "");
  const raw = childProps.children;
  const text = typeof raw === "string"
    ? raw
    : Array.isArray(raw)
      ? raw.join("")
      : "";
  return { lang: langMatch?.[1] ?? "", text };
}

export function CodeBlock({ children, ...props }: HTMLAttributes<HTMLPreElement>) {
  const t = useLang();
  const [copied, setCopied] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const { lang, text } = extractCode(children);

  // 懒加载高亮:shiki chunk 到位 + 语言加载完成后替换纯文本;失败保持回退
  useEffect(() => {
    let alive = true;
    if (!text) return;
    highlightCodeBlock(text.replace(/\n$/, ""), lang).then((h) => {
      if (alive && h) setHtml(h);
    });
    return () => {
      alive = false;
    };
  }, [text]);

  const handleCopy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative group my-3" data-testid="md-codeblock">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-1 border border-b-0 border-[var(--border-faint)] rounded-t-md">
        <span className="text-caption font-mono text-ink-faint uppercase tracking-wider">
          {lang || "code"}
        </span>
        <button
          onClick={handleCopy}
          aria-label={t("chat.copy")}
          className="text-caption text-ink-muted hover:text-brand transition-colors opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100 inline-flex items-center gap-1"
          data-testid="md-copy"
        >
          {copied ? (
            <><Check className="w-3 h-3 inline" />{t("chat.copied")}</>
          ) : (
            <><Copy className="w-3 h-3 inline" />{t("chat.copy")}</>
          )}
        </button>
      </div>
      {html ? (
        <div className="md-shiki" data-testid="md-shiki" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre {...props} className="!mt-0 !rounded-t-none !border-t-0">
          {children}
        </pre>
      )}
    </div>
  );
}
