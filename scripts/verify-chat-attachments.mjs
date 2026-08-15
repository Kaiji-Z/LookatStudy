/**
 * verify-chat-attachments —— 聊天附件纯函数的回归套件。
 *
 * 覆盖两处纯层:
 *   - shared/attachment-intake.ts:类型判定/大小门禁/正文内联(围栏防逃逸)
 *   - src/main/services/pure/attachment-files.ts:文件名守卫(路径穿越)/parts 解析
 *
 * 运行:tsx scripts/verify-chat-attachments.mjs(verify:core 的一员)
 */
import assert from "node:assert";
import {
  ATTACHMENT_LIMITS,
  checkAttachmentFile,
  fileExtension,
  buildContentWithTextAttachments,
} from "../shared/attachment-intake.ts";
import {
  isSafeAttachmentFile,
  isSupportedImageMime,
  makeAttachmentFilename,
  collectAttachmentFilesFromParts,
} from "../src/main/services/pure/attachment-files.ts";

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    console.log(`✓ ${name}`);
    pass++;
  } else {
    console.log(`✗ ${name}`);
    fail++;
  }
}

/* ---- T1 fileExtension ---- */
check("T1a 常规扩展", fileExtension("foo.py") === "py");
check("T1b 大写归一", fileExtension("FOO.PY") === "py");
check("T1c 无扩展 → 空串", fileExtension("Makefile") === "");
check("T1d 点开头不算扩展", fileExtension(".gitignore") === "");
check("T1e 尾点 → 空串", fileExtension("foo.") === "");

/* ---- T2 checkAttachmentFile 类型判定 ---- */
check("T2a png mime → image", checkAttachmentFile("a.png", "image/png", 100).ok === true && checkAttachmentFile("a.png", "image/png", 100).kind === "image");
check("T2b mime 缺省靠扩展名兜底(jpg)", checkAttachmentFile("photo.jpg", "", 100).ok === true);
check("T2c webp 扩展兜底", checkAttachmentFile("d.webp", "", 100)?.ok === true);
check("T2d py → text", checkAttachmentFile("a.py", "text/x-python", 100).kind === "text");
check("T2e md → text", checkAttachmentFile("README.md", "", 1000).kind === "text");
check("T2f exe → unsupported", checkAttachmentFile("a.exe", "application/octet-stream", 100)?.reason === "unsupported");
check("T2g zip → unsupported", checkAttachmentFile("a.zip", "", 100)?.reason === "unsupported");
check("T2h 无扩展无 mime → unsupported", checkAttachmentFile("Makefile", "", 100)?.reason === "unsupported");

/* ---- T3 大小门禁 ---- */
check("T3a 图片恰好 5MB 通过", checkAttachmentFile("a.png", "image/png", ATTACHMENT_LIMITS.maxImageBytes).ok === true);
check("T3b 图片超 5MB 拒绝", checkAttachmentFile("a.png", "image/png", ATTACHMENT_LIMITS.maxImageBytes + 1)?.reason === "tooLargeImage");
check("T3c 文本恰好 256KB 通过", checkAttachmentFile("a.py", "text/plain", ATTACHMENT_LIMITS.maxTextBytes).ok === true);
check("T3d 文本超 256KB 拒绝", checkAttachmentFile("a.py", "text/plain", ATTACHMENT_LIMITS.maxTextBytes + 1)?.reason === "tooLargeText");
check("T3e 上限常量自洽(4/5MB/256KB)", ATTACHMENT_LIMITS.maxPerMessage === 4 && ATTACHMENT_LIMITS.maxImageBytes === 5 * 1024 * 1024);

/* ---- T4 buildContentWithTextAttachments ---- */
{
  const out = buildContentWithTextAttachments("看这段", [{ name: "a.py", text: "print(1)" }]);
  check("T4a 原文在前", out.startsWith("看这段"));
  check("T4b 附件名标注", out.includes("附件 a.py:"));
  check("T4c 语言围栏(python)", out.includes("```python"));
  check("T4d 正文包含", out.includes("print(1)"));
}
{
  // 内容里带 ``` 的逃逸尝试:外层必须用四反引号围栏,内层 ``` 不提前闭合
  const out = buildContentWithTextAttachments("q", [{ name: "a.md", text: "```\nbroken\n```" }]);
  const fences4 = (out.match(/````/g) ?? []).length;
  check("T4e 四反引号围栏包裹逃逸内容", fences4 >= 2 && out.includes("broken"));
}
check("T4f 无文本附件 = 原文返回", buildContentWithTextAttachments("hi", []) === "hi");
{
  const out = buildContentWithTextAttachments("m", [
    { name: "a.ts", text: "let x" },
    { name: "b.sh", text: "ls" },
  ]);
  check("T4g 多附件都内联", out.includes("let x") && out.includes("ls") && out.includes("附件 b.sh:"));
}

/* ---- T5 isSafeAttachmentFile(路径穿越守卫) ---- */
check("T5a 合法 uuid.png", isSafeAttachmentFile("01234567-89ab-cdef-0123-456789abcdef.png") === true);
check("T5b 合法 uuid.jpg 大小写宽容", isSafeAttachmentFile("01234567-89AB-CDEF-0123-456789ABCDEF.JPG") === true);
check("T5c 路径穿越 ../", isSafeAttachmentFile("../../../etc/passwd.png") === false);
check("T5d 分隔符 a/b.png", isSafeAttachmentFile("a/b.png") === false);
check("T5e Windows 分隔符", isSafeAttachmentFile("..\\x.png") === false);
check("T5f 盘符", isSafeAttachmentFile("c:\\x.png") === false);
check("T5g 双扩展", isSafeAttachmentFile("01234567-89ab-cdef-0123-456789abcdef.png.exe") === false);
check("T5h 无扩展", isSafeAttachmentFile("01234567-89ab-cdef-0123-456789abcdef") === false);
check("T5i 非法扩展 svg", isSafeAttachmentFile("01234567-89ab-cdef-0123-456789abcdef.svg") === false);
check("T5j uuid 长度不对", isSafeAttachmentFile("abc.png") === false);

/* ---- T6 mime 落盘映射 ---- */
check("T6a 四种图片 mime 支持", isSupportedImageMime("image/png") && isSupportedImageMime("image/jpeg") && isSupportedImageMime("image/webp") && isSupportedImageMime("image/gif"));
check("T6b svg mime 不落盘", isSupportedImageMime("image/svg+xml") === false);
check("T6c 文件名 = uuid.ext", /^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/.test(makeAttachmentFilename("image/png", () => "01234567-89ab-cdef-0123-456789abcdef")));
assert.throws(() => makeAttachmentFilename("image/svg+xml", () => "x"), "T6d 不支持 mime 抛错");
check("T6d 不支持 mime 抛错", true);

/* ---- T7 collectAttachmentFilesFromParts ---- */
{
  const file1 = "01234567-89ab-cdef-0123-456789abcdef.png";
  const file2 = "01234567-89ab-cdef-0123-456789abcde2.jpg";
  const parts = JSON.stringify([
    { type: "attachment", attachment: { kind: "image", name: "a.png", mime: "image/png", size: 1, file: file1 } },
    { type: "attachment", attachment: { kind: "text", name: "a.py", mime: "text/plain", size: 1 } },
    { type: "text", text: "hi" },
    { type: "attachment", attachment: { kind: "image", name: "b.png", mime: "image/png", size: 1, file: file2 } },
  ]);
  const files = collectAttachmentFilesFromParts(parts);
  check("T7a 收集两个图片文件", files.length === 2 && files[0] === file1 && files[1] === file2);
}
check("T7b null → 空", collectAttachmentFilesFromParts(null).length === 0);
check("T7c 畸形 JSON → 空(不抛)", collectAttachmentFilesFromParts("{broken").length === 0);
check("T7d 非 array JSON → 空", collectAttachmentFilesFromParts('{"a":1}').length === 0);
{
  // 恶意 parts 里的穿越文件名必须被守卫丢弃
  const parts = JSON.stringify([
    { type: "attachment", attachment: { kind: "image", name: "x", mime: "image/png", size: 1, file: "../../evil.png" } },
  ]);
  check("T7e 穿越文件名被丢弃", collectAttachmentFilesFromParts(parts).length === 0);
}

console.log(fail === 0 ? `\nALL PASS (${pass})` : `\nFAIL (${fail}/${pass + fail})`);
process.exit(fail === 0 ? 0 : 1);
