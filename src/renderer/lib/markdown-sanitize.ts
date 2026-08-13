/**
 * markdown-sanitize —— ReactMarkdown 渲染 HTML 标签时的 sanitize schema。
 *
 * 背景:react-markdown v9 默认不渲染 HTML 标签(<strong>/<em> 等被忽略)。要支持讲解内容里
 * 的内嵌 HTML(导入的课程 markdown 常含 <strong>/<em>/<sub>/<sup> 等),配 rehype-raw。
 * 但 rehype-raw 单独用有 XSS 风险(讲解内容虽是导入课程 + AI 生成,相对可信,仍需防御),
 * 配 rehype-sanitize 用 defaultSchema:允许常见格式标签(strong/em/a/code/img/table),
 * 排除 script/iframe/on* 事件属性/javascript: 协议。
 *
 * 扩展 defaultSchema:img.src 放行 data: URL —— 导入管线把小图 base64 内联(data:image/...),
 * defaultSchema 默认只允许 http/https/mailto,会删 data: src 导致图裂(CSP 已放行 data:,
 * 见 memory csp-img-src-blocks-base64)。这里同步放行,保持 base64 内联图可见。
 */
import { defaultSchema } from "rehype-sanitize";

export const markdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    // 放行 data: 协议(base64 内联图);其他协议沿用 defaultSchema(http/https/mailto)
    src: [...(defaultSchema.protocols?.src ?? ["http", "https", "mailto"]), "data"],
  },
};
