<div align="center">

# LookatStudy

**把任意仓库,变成一门你真的能学完的课程。**

多邻国式技能地图 + 追踪你真实掌握度的 AI 导师 ——
用你自己的学习材料构建,100% 本地运行,LLM Key 自己带。

[![License: MIT](https://img.shields.io/badge/license-MIT-58cc02.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Kaiji-Z/LookatStudy?color=1cb0f6&label=release)](https://github.com/Kaiji-Z/LookatStudy/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-ffc800)](#快速开始)

<img src="docs/screenshots/01-overview.png" alt="LookatStudy —— 技能地图、AI 导师对话、康奈尔笔记,一窗三栏" width="880">

[English](README.md) | **简体中文**

</div>

---

## 你收藏了 47 篇教程,一篇都没学完

这不是自律问题。**文档从来就不是课程。**

| 课程给你 | 一堆文档给你 |
| --- | --- |
| 一条路径 —— 今天该学什么 | 300 个文件,没有顺序 |
| 反馈 —— 我到底懂没懂 | 沉默 |
| 记忆 —— 趁忘掉之前复习 | 读一遍,周五就忘光 |
| 明天再来的理由 | 又一个再也不会打开的标签页 |

LookatStudy 把缺失的四样补在你已有的材料上 —— GitHub 仓库、本地文件夹、粘贴的 Markdown —— 把它变成一门有门控、会自适应、粘得住的课程。

## 🧠 知道你哪个知识点薄弱的 AI 导师

<img src="docs/screenshots/02-ai-tutor.png" alt="AI 导师以「先猜后讲」的钩子开场" width="880">

不是"文档阅读器外挂聊天窗"。每道题的作答都会更新**逐知识点的 BKT(贝叶斯知识追踪)模型** —— 导师知道你递归很稳但闭包发虚,于是只练缺口,不陪你重刷整章。章节 Boss 考试在后台生成限时题,覆盖该章全部知识点。

AI 从不直接改你的学习档案:掌握度更新以**提议卡**的形式出现,由你批准(Propose → Apply)。三种可切换的教学人设 —— 精讲 / 引导 / 实战 —— 改变的是教法,不是所学内容。

## 🗺️ 真门控的技能树 + 秒跳全课的搜索

<img src="docs/screenshots/03-course-search.png" alt="课程搜索:全课大纲树 + 跳转导航" width="880">

章节解锁章节,Boss 考试守关。一节课不算"完成",直到你**掌握其中的每一个知识点**(取各概念的最小值 —— 不是打个勾就算)。搜索同时匹配标题与全文,大纲树一键跳到任何一课;未解锁的节点照样锁着,不剧透。

## 📥 (几乎)什么都能导入

- **GitHub URL** —— 自动发现 README + 爬取文件树;LLM 判定每个文件的角色并设计课程结构
- **本地文件夹** —— 同一套管线跑在磁盘上(下载的课程包、克隆的仓库、自己的笔记)
- **粘贴 Markdown** —— 私有仓库、随手记录都行
- **10 种文档格式** —— `.md` `.ipynb` `.rst` `.Rmd` `.org` `.adoc` `.pdf` `.pptx` `.html` `.txt`
- **30+ 种代码文件** —— `.py` `.ts` `.go` `.rs` `.java` `.c` `.cpp` `.rb` `.sh` …… 代码也是教材,docstring 提取成正文
- **图片随内容一起迁移** —— notebook 输出图、PDF 内嵌图、`<img>` 标签;可选 AI 视觉理解
- **双语仓库** —— 自动识别翻译约定(`translations/{lang}/`、平行目录、`file.zh.md` 后缀配对)并自动配对

## 🔁 记忆保持工程

答一道题 → **SM-2** 在你即将遗忘前重新排期。每日 XP、可冻结的连续学习、带交错复习的复习抽屉。每天把你拉回多邻国的是同一套机制 —— 只不过这里,它挂在你*自己选*的内容上。

## 🔒 本地优先 · 自带 Key · 零遥测

SQLite 就在你的磁盘上。无账号、无云同步、无埋点。LLM Key 自己带 —— **19 个预设服务商**(GLM、DeepSeek、Kimi、Qwen、SiliconCloud、OpenRouter、OpenAI、Anthropic、Google、Groq、Mistral、xAI ……)或任意 OpenAI 兼容自定义端点。Key 只存在于主进程,渲染层连看都看不到。

## 快速开始

**Windows** —— 到 [Releases](https://github.com/Kaiji-Z/LookatStudy/releases) 下载安装包(v0.9.0+)。

**任意平台,源码运行**(Node.js ≥ 20):

```bash
git clone https://github.com/Kaiji-Z/LookatStudy.git
cd LookatStudy
npm install
npm run dev:electron
```

应用内置一门离线引导课程(6 章 / 18 课 / 6 场章节考试),没有 API Key 也能逛完整闭环。唤醒 AI 导师:打开**设置**(齿轮图标)→ 选服务商 → 粘贴 Key → **测试连接** → 保存。

## 技术底座

Electron 33(CJS 主进程)· React 19 + Vite 6 + Tailwind v3 · **sql.js**(SQLite → WASM,零原生编译)+ Drizzle · Vercel AI SDK v5 + zod v3。

渲染层永远碰不到数据库、文件系统、API Key —— 一切经 `shared/types.ts` 里定义一次的类型化 IPC 桥。**63 个确定性测试套件**(`npm run verify:core`)+ 无头真 GUI 断言(`npm run ui-test`)守护。

## 状态

v0.9.0 —— 核心学习闭环完整:导入(10 种文档格式 + 30+ 种代码)→ 门控技能地图 → 逐 KC BKT 的 AI 导师 + 提议制 → 间隔重复、连续学习、章节考试 → 带溯源画线的康奈尔笔记。完整历史见 [CHANGELOG.md](CHANGELOG.md)(英文)。

## 许可证

[MIT](LICENSE) © 2026 Kaiji-Z

---

<div align="center">

如果 LookatStudy 帮你学完了一件一直拖着的事 —— 欢迎 ⭐ 支持。

</div>
