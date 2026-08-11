/**
 * 代码文件解析器验证 —— 测 code-parser.ts 的纯函数。
 *
 * 不变量:
 *   - parseCode: 代码 → markdown 围栏（带语言标签）
 *   - extractLeadingDoc: Python docstring / JS /** / 通用注释块 提取
 *   - 无 docstring → 纯代码围栏；有 → 正文 + 代码围栏
 */
import assert from "node:assert";
import { parseCode, extractLeadingDoc, codeFenceLang } from "../src/main/services/pure/code-parser.ts";

// === T1: parseCode 基础（无 docstring → 纯代码围栏）===
{
  const result = parseCode('print("hello")\n', "py");
  assert.ok(result.markdown.includes("```python"), "T1: python 围栏");
  assert.ok(result.markdown.includes('print("hello")'), "T1: 代码保留");
  console.log("✓ T1 parseCode: 无 docstring → 纯代码围栏");
}

// === T2: parseCode Python docstring 提取 ===
{
  const code = `"""这是模块文档。
讲解这个模块做什么。"""

import os
print("hello")`;
  const result = parseCode(code, "py");
  assert.ok(result.markdown.includes("这是模块文档"), "T2: docstring 提取为正文");
  assert.ok(result.markdown.includes("```python"), "T2: 代码围栏");
  assert.ok(result.markdown.includes('print("hello")'), "T2: 代码保留");
  console.log("✓ T2 parseCode: Python docstring → 正文 + 代码围栏");
}

// === T3: parseCode 多语言围栏标签 ===
{
  assert.ok(parseCode("let x = 1;", "js").markdown.includes("```javascript"), "T3: js → javascript");
  assert.ok(parseCode("let x = 1;", "ts").markdown.includes("```typescript"), "T3: ts → typescript");
  assert.ok(parseCode("fmt.Println()", "go").markdown.includes("```go"), "T3: go → go");
  assert.ok(parseCode("fn main() {}", "rs").markdown.includes("```rust"), "T3: rs → rust");
  console.log("✓ T3 parseCode: 多语言围栏标签正确");
}

// === T4: extractLeadingDoc Python ===
{
  const code = `"""Module docstring here.
Second line."""

import os`;
  const { doc, code: rawCode } = extractLeadingDoc(code, "py");
  assert.ok(doc.includes("Module docstring"), "T4: Python docstring 提取");
  assert.ok(doc.includes("Second line"), "T4: 多行 docstring");
  assert.ok(rawCode === code, "T4: code 字段是完整原文");
  console.log("✓ T4 extractLeadingDoc: Python docstring");
}

// === T5: extractLeadingDoc Python 无 docstring ===
{
  const code = `import os\nprint("hello")`;
  const { doc } = extractLeadingDoc(code, "py");
  assert.strictEqual(doc, "", "T5: 无 docstring → 空");
  console.log("✓ T5 extractLeadingDoc: 无 docstring → 空");
}

// === T6: extractLeadingDoc 通用注释块（Python #）===
{
  const code = `# 这是一个 Python 脚本
# 它做了一些事情
# 第三行注释

import os`;
  const { doc } = extractLeadingDoc(code, "py");
  assert.ok(doc.length > 10, `T6: 连续注释提取（${doc.length} 字符）`);
  assert.ok(doc.includes("Python 脚本"), "T6: 注释内容提取");
  console.log("✓ T6 extractLeadingDoc: 通用 # 注释块（≥3 行）");
}

// === T7: extractLeadingDoc 许可证块过滤 ===
{
  const code = `# Copyright (c) 2024
# Licensed under MIT License

import os`;
  const { doc } = extractLeadingDoc(code, "py");
  assert.strictEqual(doc, "", "T7: 许可证块不提取为文档");
  console.log("✓ T7 extractLeadingDoc: 许可证/copyright 块过滤");
}

// === T8: codeFenceLang 映射 ===
{
  assert.strictEqual(codeFenceLang("py"), "python");
  assert.strictEqual(codeFenceLang("js"), "javascript");
  assert.strictEqual(codeFenceLang("go"), "go");
  assert.strictEqual(codeFenceLang("unknown"), "");
  console.log("✓ T8 codeFenceLang: 扩展名 → 语言标签映射");
}

// === T9: parseCode 短注释（< 3 行不提取）===
{
  const code = `# 只有一行注释\nimport os`;
  const { doc } = extractLeadingDoc(code, "py");
  assert.strictEqual(doc, "", "T9: <3 行注释不提取");
  console.log("✓ T9 extractLeadingDoc: <3 行注释不提取");
}

// === T10: parseCode JS 块注释 ===
{
  const code = `/**
 * This is a JS module.
 * It teaches you about callbacks.
 */

const x = 1;`;
  const { doc } = extractLeadingDoc(code, "js");
  assert.ok(doc.includes("JS module"), `T10: JS 块注释提取（${doc}）`);
  console.log("✓ T10 extractLeadingDoc: JS /** */ 块注释");
}

console.log("\n=== ALL CODE PARSER TESTS PASSED ✅ ===");
