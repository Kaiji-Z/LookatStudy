/**
 * Pure YAML-frontmatter 解析器（零依赖，可被测试直接 import，不走 DB/electron）。
 *
 * 通用件：同时服务 soul（教学人设）和未来的真 skill（过程性 playbook）——凡是
 * Markdown + frontmatter（name/description + body）的存储格式都用它解析。
 *
 * 处理 description 的三种形态：
 *   - plain 单行（`description: xxx`）
 *   - 双引号（`description: "xxx"`）
 *   - | block scalar（多行，缩进折叠）
 * 返回 body（`---` 之后的逐字内容）。手写 YAML 子集，不引入额外依赖。
 */

export interface FrontmatterParsed {
  name: string;
  description: string;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): FrontmatterParsed {
  const m = raw.match(FRONTMATTER);
  if (!m) return { name: "", description: "", body: raw };
  const [, front, body] = m;
  return { name: fieldName(front), description: fieldDescription(front), body };
}

function fieldName(front: string): string {
  const m = front.match(/^name:\s*(.*)$/m);
  return m ? unquote(m[1].trim()) : "";
}

function fieldDescription(front: string): string {
  const lines = front.split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return "";
  const first = lines[i].replace(/^description:\s*/, "");
  // YAML block scalar（`|`/`|-`/`>`）或空 inline → 收集缩进行
  if (first.trim() === "" || /^[|>][-+]?\s*$/.test(first.trim())) {
    const block: string[] = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j];
      if (l.trim() === "") {
        block.push("");
        continue;
      }
      if (!/^\s/.test(l)) break; // 去缩进 → 下一个 frontmatter key
      block.push(l.replace(/^\s+/, ""));
    }
    return block.join(" ").replace(/\s+/g, " ").trim();
  }
  return unquote(first.trim());
}

function unquote(s: string): string {
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
