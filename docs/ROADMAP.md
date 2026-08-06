# LookatStudy Milestone 规划 v3

> v3 变更：吸收 DeepTutor 竞品分析的发现。
> 新增：BKT 掌握度（M2）、轻量 RAG（M3）、记忆系统（M3）。
> v0.2 路线：IRT + 完整 RAG。
>
> 核心判断不变：**M1-M4 做完 = 通用学习闭环可用版（10 周）。**

---

## 设计原则

1. 每个 milestone 可独立 dogfood——断了也能用
2. 通用核心优先于学科特性
3. Skill 系统尽早引入（差异化核心）
4. 掌握度模型先 BKT 后 IRT（数据驱动升级）
5. 每个 milestone 都要有自动化测试

---

## 已完成

### ✅ M0 · 脚手架（已完成）
- Vite + React + Electron + TS + sql.js + Drizzle
- 11 张表（含 v2 的 skills/proposals/friction_log）
- SM-2 SRS（8 项测试）+ Streak+Freeze（8 项测试）
- 种子课程：Awesome-FDE-Roadmap（7 section + 34 lesson）
- 25 项核心测试全过 + Electron 运行时验证
- 债务清理完成（schema 单一来源 + 术语统一 + 依赖干净）

---

## v0.1 核心里程碑（M1-M4：通用学习闭环）

### M1 · Skill 系统 + 课程树 UI（1.5 周）

**做什么**：
- `skills` 表 CRUD + IPC handler
- Skill 文件格式：Markdown + YAML frontmatter（移植 OpenChatCut 的 `skill-frontmatter.ts`）
- 内置 4 个学习模式：`socratic-mode` / `exam-prep-mode` / `project-mode` / `review-mode`
- Skill 切换 UI
- 课程树可视化（多邻国式路径，替换当前列表视图）
- 种子课程补全到 11 section（完整 Awesome-FDE-Roadmap）

**产出**：用户看到完整课程树，切换学习模式。

### M2 · Agent 引擎 + Propose/Apply + BKT（2.5 周）⭐ 加深

**做什么**：
- Agent tool loop（借鉴 OpenChatCut `runtime.ts` 的 `for(;;)` + streamText）
- Provider 抽象（借鉴 `shared/llm-providers.ts`，BYO key）
- Keystore（密钥不离开主进程）
- Propose → Apply 流水线（`proposals` 表 + 审批 UI）
- Capability manifest
- Skill 注入 system prompt（socratic-mode 默认激活）
- **🆕 BKT 掌握度模型**：
  - 每个知识点（concept node）维护 `mastery_probability`（0-1）
  - 答对升、答错降（贝叶斯更新公式，~50 行）
  - 新表 `knowledge_state`（或扩展 `progress` 表加 `mastery` 列）
  - Agent 在出题/追问时读掌握度，针对薄弱点
- **🆕 混合出题**：
  - 预生成题库（缓存在 `exercises` 表）作为主路径
  - Agent 对话中根据掌握度实时补充（"你上次答错这个，我再问个类似的"）
- 答题判定走 Propose→Apply（AI 判对错 → 提议更新掌握度 → 学习者确认）

**产出**：配 API key 后，能和 AI 导师对话学一节课。AI 知道你哪里掌握哪里薄弱，针对性出题。

**测试**：BKT 更新公式（答对/答错的概率变化）、tool loop mock、proposal 生命周期。

### M3 · SRS 复习 + 打卡仪表盘 + 轻量 RAG + 记忆（1.5 周）⭐ 加深

**做什么**：
- 每日复习入口（`getDueReviews()` → 复习卡片 UI）
- 答题后自动入 SRS 队列 + BKT 更新
- 打卡仪表盘：连续天数、freeze、本周 XP、**掌握度热力图**（哪些章节掌握了/薄弱）
- 学习目标设置（每日 XP）
- `friction_log`（Agent 静默记录卡壳时刻）
- **🆕 轻量 RAG**：
  - 在 `content_nodes.content` 上做 SQLite FTS5 全文检索
  - Agent 回答"这个概念在哪节课讲过"类问题时调 `search_content(query)` 工具
  - 不上海量向量库（v0.1 内容规模小，FTS5 够用）
- **🆕 记忆系统**（借鉴 DeepTutor）：
  - agent 自维护一个 `SUMMARY.md`（学习历程滚动摘要）
  - 存 `settings` 或单独 `memory` 表
  - 跨会话保留（学习者下次来，AI 记得上次哪里卡过）

**产出**：多邻国式每日回访闭环 + 跨章节检索 + 跨会话记忆 + 掌握度可视化。

**测试**：FTS5 检索准确性、记忆持久化、掌握度热力图数据。

### M4 · Course Generator + 渐进式 Skill（2 周）

**做什么**：
- Course Generator 两阶段：
  - 阶段 A：导入仓库 → 解析 markdown → LLM 生成骨架 → **走 Proposal 让用户调整**（借鉴 DeepTutor 的零配置理念）
  - 阶段 B：打开某节课时按需生成讲解 + 练习题（缓存）
- LabType 自动检测（doc/code/notebook）
- 学科知识包 Skill（System B）：
  - `import.meta.glob` 打包 `skills/` 目录
  - 渐进式披露（清单在 prompt，内容按需 `load_skill`）
  - 先写 5-10 个学科包
- dogfood：Course Generator 重新生成 Awesome-FDE-Roadmap，对比手工种子

**产出**：任何 Markdown 仓库都能变成课程。

---

## v0.1 可选增强（M5-M6）

### M5 · CodeLab + MCP（1.5 周，可选）

- `CodeLabAdapter`：MCP 读学习者代码、跑测试、看 diff
- LookatStudy 当 MCP server：暴露 `get_today_lesson` / `submit_exercise` / `ask_tutor`
- 只读先行，写操作留 v0.2
- `project-mode` skill 配合

**注意**：MCP server 不再算"护城河"（DeepTutor 已有）。做，但不当卖点。

### M6 · 打磨 + 开源发布（1 周）

- README（中英双语）+ 截图 + 快速开始
- 5 个 dogfood 案例
- E2E 测试（Playwright）
- 打包 mac/win
- 发 v0.1.0 release

---

## v0.2 路线（v0.1 发布后，数据驱动）

| 能力 | 触发条件 | 预估工作量 |
|---|---|---|
| **IRT 升级 BKT** | 有 500+ 答题记录，参数能收敛 | 1.5 周 |
| **完整 RAG**（vector + BM25 + rerank） | 用户频繁跨章节提问 | 2 周 |
| **CodeLab 写操作**（受控改代码，git stash 保护） | 只读实战体感不够 | 1 周 |
| **知识图谱**（知识点关联，懂 A 预测 B） | IRT 数据足够 | 2 周 |
| **CLI 表面**（让 Claude Code 驱动 LookatStudy） | 有用户要求 IDE 集成 | 1 周 |

---

## 时间线总览

| Milestone | 时长 | 累计 | 核心交付 |
|---|---|---|---|
| M0 ✅ | 1 周 | 1 周 | 脚手架 |
| M1 | 1.5 周 | 2.5 周 | Skill 系统 + 课程树 UI |
| M2 | 2.5 周 | 5 周 | Agent + Propose/Apply + **BKT 掌握度** |
| M3 | 1.5 周 | 6.5 周 | SRS UI + 打卡 + **轻量 RAG** + **记忆** |
| M4 | 2 周 | 8.5 周 | Course Generator（通用化） |
| M5 | 1.5 周 | 10 周 | CodeLab + MCP（可选） |
| M6 | 1 周 | 11 周 | 开源发布 |

**v0.1 = 11 周**（比原 10 周多 1 周，因为加了 BKT/RAG/记忆）。

---

## 风险与开放问题

| # | 问题 | 影响 | 应对 |
|---|---|---|---|
| R1 | BKT 的先验概率怎么定 | 掌握度准确性 | 参考文献默认 P(掌握)=0.5，转移概率 0.1/0.2 |
| R2 | FTS5 中文分词 | 检索质量 | v0.1 先用 LIKE 兜底，FTS5 配置留优化 |
| R3 | 记忆 SUMMARY.md 何时更新 | LLM 成本 | 每会话结束更新一次，不是每轮 |
| R4 | Course Generator 质量不稳定 | 核心体验 | 先 dogfood FDE 单仓库，prompt 精调 |
| R5 | 混合出题的实时部分增加延迟 | 体验 | 预生成题为主（80%），实时补充为辅（20%） |
| R6 | Skill 数量爆炸 | context 膨胀 | 早期硬封顶（学习模式 4 个 + 学科包 10 个） |
