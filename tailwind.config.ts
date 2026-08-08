import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  content: ["./src/renderer/**/*.{ts,tsx,html}", "./index.html"],
  // 深色优先；多邻国式学习产品的现代观感
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // 多邻国风格的活力色 + 深色底。真源在 src/renderer/index.css :root。
        // 用 rgb(var(--xxx-rgb) / <alpha-value>) 形式让 Tailwind 的 /opacity
        // 修饰符(bg-brand/10、border-brand/30)正常工作。
        // --xxx(OKLCH)用于 CSS 渐变/发光;--xxx-rgb 用于 Tailwind 工具类。
        brand: {
          DEFAULT: "rgb(var(--brand-rgb) / <alpha-value>)",
          dark: "rgb(var(--brand-dark-rgb) / <alpha-value>)",
          light: "rgb(var(--brand-light-rgb) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent-rgb) / <alpha-value>)",
          dark: "rgb(var(--accent-dark-rgb) / <alpha-value>)",
          light: "rgb(var(--accent-light-rgb) / <alpha-value>)",
        },
        gold: {
          DEFAULT: "rgb(var(--gold-rgb) / <alpha-value>)",
          dark: "rgb(var(--gold-dark-rgb) / <alpha-value>)",
          light: "rgb(var(--gold-light-rgb) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "rgb(var(--warning-rgb) / <alpha-value>)",
          dark: "rgb(var(--warning-dark-rgb) / <alpha-value>)",
          light: "rgb(var(--warning-light-rgb) / <alpha-value>)",
        },
        review: "rgb(var(--review-rgb) / <alpha-value>)", // SRS 复习/streak 连击(橙)
        exam: {
          DEFAULT: "rgb(var(--exam-rgb) / <alpha-value>)",
          dark: "rgb(var(--exam-dark-rgb) / <alpha-value>)",
          light: "rgb(var(--exam-light-rgb) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ['"DIN Round"', "system-ui", "-apple-system", "sans-serif"],
      },
      // v0.2: AI 输出 Markdown 排版(配合 @tailwindcss/typography 的 prose)
      // 学习场景的版式:标题层级清晰、代码块醒目、表格紧凑、列表有节奏
      typography: {
        DEFAULT: {
          css: {
            // 暗色优先:正文文字
            color: "rgb(229 229 234)", // neutral-200
            maxWidth: "none", // 不限宽,撑满对话气泡
            // 标题层级(学习内容需要明显的视觉层次)
            h1: { fontSize: "1.25rem", fontWeight: "800", marginTop: "1.25em", marginBottom: "0.5em", color: "rgb(245 245 250)" },
            h2: { fontSize: "1.1rem", fontWeight: "700", marginTop: "1.2em", marginBottom: "0.4em", color: "rgb(245 245 250)", paddingBottom: "0.3em", borderBottom: "1px solid rgb(38 38 45)" },
            h3: { fontSize: "1rem", fontWeight: "700", marginTop: "1em", marginBottom: "0.3em", color: "rgb(229 229 234)" },
            h4: { fontSize: "0.9rem", fontWeight: "700", marginTop: "0.8em", marginBottom: "0.2em", color: "rgb(229 229 234)" },
            // 段落与链接
            p: { marginTop: "0.6em", marginBottom: "0.6em", lineHeight: "1.65" },
            a: { color: "#1cb0f6", textDecoration: "none", fontWeight: "500", "&:hover": { textDecoration: "underline" } },
            strong: { color: "rgb(245 245 250)", fontWeight: "700" },
            em: { color: "rgb(229 229 234)" },
            // 列表(有序/无序)——学习内容常分步骤
            ul: { marginTop: "0.5em", marginBottom: "0.5em", paddingLeft: "1.3em", listStyleType: "disc" },
            ol: { marginTop: "0.5em", marginBottom: "0.5em", paddingLeft: "1.3em", listStyleType: "decimal" },
            li: { marginTop: "0.25em", marginBottom: "0.25em", paddingLeft: "0.2em" },
            "li::marker": { color: "#58cc02" }, // 列表标记用品牌绿,呼应学习进度语义
            // 引用块(常用于"提示""重要")
            blockquote: {
              borderLeftColor: "#1cb0f6",
              borderLeftWidth: "3px",
              backgroundColor: "rgb(28 176 246 / 0.06)",
              paddingLeft: "0.9em",
              paddingTop: "0.4em",
              paddingBottom: "0.4em",
              marginTop: "0.8em",
              marginBottom: "0.8em",
              color: "rgb(200 200 210)",
              fontStyle: "normal",
              borderRadius: "0 0.4rem 0.4rem 0",
            },
            // 行内代码——醒目的 mono 胶囊
            code: {
              backgroundColor: "rgb(38 38 45)",
              color: "#1cb0f6",
              padding: "0.15em 0.4em",
              borderRadius: "0.3rem",
              fontSize: "0.85em",
              fontWeight: "500",
              "&::before": { content: '""' }, // 去掉默认反引号
              "&::after": { content: '""' },
            },
            // 代码块(多行)——深色面板 + 横滚
            pre: {
              backgroundColor: "rgb(10 10 14)",
              color: "rgb(229 229 234)",
              borderRadius: "0.5rem",
              padding: "0.9em 1em",
              marginTop: "0.7em",
              marginBottom: "0.7em",
              overflowX: "auto",
              border: "1px solid rgb(38 38 45)",
              fontSize: "0.82em",
              lineHeight: "1.55",
            },
            "pre code": {
              backgroundColor: "transparent",
              color: "inherit",
              padding: "0",
              borderRadius: "0",
              fontSize: "inherit",
              fontWeight: "inherit",
            },
            // 表格——学习场景高频(对比、规格、属性)
            table: {
              marginTop: "0.8em",
              marginBottom: "0.8em",
              fontSize: "0.85em",
              borderCollapse: "collapse",
              width: "100%",
              display: "block",
              overflowX: "auto", // 宽表格横滚,不挤烂
            },
            thead: {
              borderBottomWidth: "2px",
              borderBottomColor: "#58cc02", // 表头底线用品牌绿
            },
            th: {
              color: "rgb(245 245 250)",
              fontWeight: "700",
              textAlign: "left",
              padding: "0.5em 0.7em",
              fontSize: "0.95em",
            },
            td: {
              padding: "0.45em 0.7em",
              borderBottom: "1px solid rgb(38 38 45)",
              verticalAlign: "top",
              color: "rgb(229 229 234)",
            },
            "tbody tr:nth-child(odd)": { backgroundColor: "rgb(38 38 45 / 0.3)" }, // 斑马纹
            // 水平分割线
            hr: {
              borderColor: "rgb(38 38 45)",
              marginTop: "1.2em",
              marginBottom: "1.2em",
            },
            // 图片
            img: { borderRadius: "0.5rem", marginTop: "0.6em", marginBottom: "0.6em" },
          },
        },
      },
    },
  },
  plugins: [typography],
} satisfies Config;
