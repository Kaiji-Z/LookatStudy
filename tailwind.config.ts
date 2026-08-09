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
      // 动效曲线:与 index.css :root 的 --ease-* 同值。Tailwind 用字符串字面量,
      // 改曲线两处同步(index.css 用 var() 给 component class,Tailwind 给 utility)。
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",   // 状态入场/反馈
        "out-back": "cubic-bezier(0.34, 1.2, 0.64, 1)", // 轻回弹(卡片/解锁)
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",    // 按钮按下回弹
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",   // 通用 hover/focus
      },
      // keyframes:注册进 Tailwind,可用 animate-* 工具类。
      // PRODUCT.md motion 规范:150-250ms,状态传达非装饰,reduced-motion 全局降级。
      keyframes: {
        // 已有(从 index.css 迁移,统一管理)
        "msg-enter": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { opacity: "0.3", transform: "translateY(0)" },
          "30%": { opacity: "1", transform: "translateY(-4px)" },
        },
        "bubble-pulse": {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.04)" },
        },
        // PRODUCT.md 承诺但原未实现的:
        "tab-slide": {
          from: { opacity: "0", transform: "translateX(8px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "panel-collapse": {
          from: { opacity: "0", transform: "scaleY(0.96)" },
          to: { opacity: "1", transform: "scaleY(1)" },
        },
        "artifact-render": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        // 答题反馈(状态传达:对/错瞬间,非循环)
        "answer-correct": {
          "0%": { transform: "scale(1)" },
          "40%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)" },
        },
        "answer-wrong": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%, 60%": { transform: "translateX(-3px)" },
          "40%, 80%": { transform: "translateX(3px)" },
        },
        // 节点解锁瞬间(一次性 scale-up,非循环;循环脉冲走 bubble-pulse)
        "node-unlock": {
          from: { transform: "scale(0.85)", opacity: "0.6" },
          to: { transform: "scale(1)", opacity: "1)" },
        },
        // path-draw 已迁到 index.css(MapRail 内联 animation 用,统一管理)
      },
      animation: {
        "msg-enter": "msg-enter 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "typing-dot": "typing-dot 1.2s ease-in-out infinite",
        "bubble-pulse": "bubble-pulse 2.4s ease-in-out infinite",
        "tab-slide": "tab-slide 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        "panel-collapse": "panel-collapse 200ms cubic-bezier(0.16, 1, 0.3, 1)",
        "artifact-render": "artifact-render 220ms cubic-bezier(0.34, 1.2, 0.64, 1)",
        "answer-correct": "answer-correct 350ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        "answer-wrong": "answer-wrong 320ms ease-in-out",
        "node-unlock": "node-unlock 280ms cubic-bezier(0.34, 1.56, 0.64, 1)",
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
