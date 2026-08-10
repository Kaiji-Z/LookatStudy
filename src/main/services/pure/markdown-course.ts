/**
 * Markdown → 课程树 纯解析器（M4 Course Generator 阶段 A 的可测核心）。
 *
 * 把一份 README.md 解析成 section/lesson 两层结构：
 *   - H2（## ）→ section
 *   - H3（### ）→ section 下的 lesson
 *   - 锚点从标题生成（GitHub 风格：小写、空格变 -、去标点）
 *
 * 零依赖，可被测试直接 import 真实源码（VERIFICATION §3.1）。
 * LLM 部分（讲解生成、质量优化）在 course-generator.ts，非确定性，不在本文件测。
 */

export interface ParsedLesson {
  title: string;
  anchor: string;
  /** 该 H3 下到下一个 H3/H2 之间的正文（逐字） */
  body: string;
  /** 文件分类器标记该课来源不确定（规则无法确定是课时正文），LLM 结构化时应优先判断 keep/skip */
  uncertain?: boolean;
}

export interface ParsedSection {
  title: string;
  anchor: string;
  lessons: ParsedLesson[];
}

export interface ParsedCourse {
  /** 第一个 H1 作为课程标题，没有则 "(untitled)" */
  title: string;
  sections: ParsedSection[];
}

/**
 * GitHub 风格的 anchor 生成：小写、去一组标点（保留中文等 unicode）、每个空格单独转 -。
 * 注意：**不合并多 -**（"A & B" → 去 & 留两空格 → "a--b"，与 GitHub slugger 一致）。
 * 与 seed.ts 的锚点对齐。
 */
export function titleToAnchor(title: string): string {
  return title
    .toLowerCase()
    .trim()
    // GitHub slugger 移除的标点集（保留字母/数字/中文/下划线/连字符）
    .replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, "")
    .replace(/ /g, "-") // 每个空格单独转 -（不合并）
    .replace(/^-|-$/g, ""); // 去首尾 -
}

/**
 * 清洗课时/章节标题 — 去 emoji、多余空格、markdown 格式符号。
 * "🛠 The Modern FDE Stack" → "The Modern FDE Stack"
 * "## [Pre-lecture quiz](url)" → "Pre-lecture quiz"
 */
export function cleanTitle(raw: string): string {
  return raw
    // 去 emoji（Unicode emoji 范围）
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "")
    // 去 markdown 链接格式 [text](url) → text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // 去 markdown 标题符号
    .replace(/^#+\s*/, "")
    // 去多余空格
    .trim()
    .replace(/\s+/g, " ")
    // 去首尾标点
    .replace(/^[·\-\.\s]+|[·\-\.\s]+$/g, "")
    .trim();
}

/**
 * 解析 markdown 为课程树。
 * 容错：H3 出现在任何 H2 之前 → 归到一个 "(前言)" section。
 */
export function parseMarkdownToCourse(md: string): ParsedCourse {
  const lines = md.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let title = "(untitled)";
  let currentSection: ParsedSection | null = null;
  let bodyBuffer: string[] = [];
  let inCodeFence = false; // ``` 或 ~~~ 围栏状态——代码块内的 #/##/### 是注释不是标题

  const flushLessonBody = () => {
    if (currentSection && currentSection.lessons.length > 0) {
      currentSection.lessons[currentSection.lessons.length - 1].body =
        bodyBuffer.join("\n").trim();
    }
    bodyBuffer = [];
  };

  for (const line of lines) {
    // 代码围栏状态机（必须在标题检测之前）
    if (/^(\s*)(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      bodyBuffer.push(line);
      continue;
    }
    // 代码块内：原样保留，不当标题处理
    if (inCodeFence) {
      bodyBuffer.push(line);
      continue;
    }
    // H1 → 课程标题（取第一个）
    if (/^#\s+/.test(line) && title === "(untitled)") {
      title = cleanTitle(line.replace(/^#\s+/, "").trim());
      continue;
    }
    // H2 → 新 section
    if (/^##\s+/.test(line)) {
      flushLessonBody();
      const sectionTitle = cleanTitle(line.replace(/^##\s+/, "").trim());
      currentSection = {
        title: sectionTitle,
        anchor: titleToAnchor(sectionTitle),
        lessons: [],
      };
      sections.push(currentSection);
      continue;
    }
    // H3 → 当前 section 下新 lesson
    if (/^###\s+/.test(line)) {
      flushLessonBody();
      const lessonTitle = cleanTitle(line.replace(/^###\s+/, "").trim());
      if (!currentSection) {
        // H3 在 H2 前：建前言 section
        currentSection = {
          title: "(前言)",
          anchor: titleToAnchor("前言"),
          lessons: [],
        };
        sections.push(currentSection);
      }
      currentSection.lessons.push({
        title: lessonTitle,
        anchor: titleToAnchor(lessonTitle),
        body: "",
      });
      continue;
    }
    // 其他行 → 当前 lesson 的 body
    bodyBuffer.push(line);
  }
  flushLessonBody();

  return { title, sections };
}

/* ---------- LabType 检测 ---------- */

export type LabType = "doc" | "code" | "notebook";

/**
 * 从 markdown 内容推断 LabType（决定 AI 能否动手操作）。
 *   - 有 ```python/```javascript/```go/```rust 等代码块 → 'code'
 *   - 有 jupyter/notebook/.ipynb 关键词 → 'notebook'
 *   - 否则 → 'doc'
 */
export function detectLabType(md: string): LabType {
  const lower = md.toLowerCase();
  // notebook 检测优先（含 .ipynb 或 jupyter 关键词）
  if (/\.ipynb|jupyter\s*notebook|colab notebook/.test(lower)) {
    return "notebook";
  }
  // 代码块检测：常见语言的 ```python/```js/```go/```rust/```java/```c++
  if (/```(python|javascript|js|typescript|ts|go|rust|java|c\+\+|cpp|c|ruby|sql|bash|sh)\b/i.test(md)) {
    return "code";
  }
  return "doc";
}
