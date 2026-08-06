# LookatStudy 架构设计 v2

> 本文档取代早期"三个 AI 角色"的设想。v2 的核心转变：
> **从"三个孤立的 AI 角色" → "一个 Agent 引擎 + Skill 驱动 + 可选 Lab Adapter"。**
>
> 这个转变源于对 OpenChatCut 架构的深度分析（见 `docs/OPENCHATCUT-PATTERNS.md`）。

---

## 一、核心设计哲学（三条原则）

### 原则 1：Agent 引擎是通用的，Skill 决定它怎么教

Agent 引擎本身**不知道在教什么**。它只是一个 tool loop：接收消息 → 调 LLM → 执行工具 → 返回结果。

"教什么、怎么教"全部由 **Skill** 定义。Skill 是可插拔的教学法包：
- "苏格拉底模式"skill 让 Agent 不直接给答案，只问引导性问题
- "考试冲刺模式"skill 让 Agent 出题、计时、不给提示
- "Python 调试工作流"skill 给 Agent 注入 Python 特有的教学知识

换 skill = 换一个老师，引擎不动。这让平台**能教任何学科**。

### 原则 2：AI 提议，人来批准（Propose → Apply）

AI 永远不直接修改学习者的持久状态（进度、课程结构、SRS 队列）。所有变更走 **Proposal** 流水线：
1. AI 在 draft（草稿）上执行操作
2. 操作被捕获成 `Proposal{ options: Operation[] }`
3. UI 展示"AI 想做这些修改"
4. 学习者点"应用" / "拒绝" / "重新提议"

**为什么**：教育产品的信任成本极高。家长/学习者必须能预览 AI 的所有改动。这也是 FDE 调研里"AI 起草、人确认提交"原则的工程化。

### 原则 3：渐进式披露（Progressive Disclosure）

系统 prompt 永远只包含**最小必要信息**：
- 所有 skill 的 name + description（一个清单）
- 当前激活的 skill 的完整内容
- 当前能力清单（capability manifest）

详细的学科知识、练习题模板、教学脚本——**按需加载**。Agent 讲到某个知识点时，调 `load_skill` 工具拉取详细内容。

**为什么**：context window 是稀缺资源。把 50 个学科的详细教学法全塞进 prompt 会爆 token 且降低质量。OpenChatCut 用这个模式管理 50+ 工具和 23 个 skill，验证可行。

---

## 二、系统分层

```
┌──────────────────────────────────────────────────────────────┐
│  渲染层 (React)                                                │
│  - 课程树 / 学习仪表盘 / Tutor 对话 / Proposal 审批 UI          │
│  - 通过 window.api.* 调主进程，不直接碰 DB / 密钥 / 文件        │
└────────────────────┬─────────────────────────────────────────┘
                     │ IPC（contextBridge 隔离）
┌────────────────────┴─────────────────────────────────────────┐
│  主进程 (Node.js)                                              │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Agent 引擎（学科无关）                                │    │
│  │  - tool loop（streamText + 工具调度）                  │    │
│  │  - propose→apply 流水线                                │    │
│  │  - capability manifest（告诉 AI 当前能做什么）         │    │
│  │  - provider 抽象（BYO key，多 Provider 路由）          │    │
│  └────────────────────┬─────────────────────────────────┘    │
│                       │                                        │
│         ┌─────────────┼─────────────┬──────────────┐         │
│         │             │             │              │         │
│  ┌──────┴──────┐ ┌────┴─────┐ ┌─────┴──────┐ ┌────┴──────┐  │
│  │ Skill 系统  │ │ 课程数据  │ │ SRS+Streak │ │ Lab 层    │  │
│  │             │ │          │ │            │ │ (可选)    │  │
│  │ 学习模式    │ │ 课程树   │ │ SM-2 队列  │ │ Doc/Code/ │  │
│  │ 学科包      │ │ 练习题   │ │ 打卡       │ │ Notebook  │  │
│  │ 用户自定义  │ │ 进度     │ │            │ │           │  │
│  └─────────────┘ └──────────┘ └────────────┘ └───────────┘  │
│                                                                │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  SQLite (sql.js)                                      │    │
│  │  courses | content_nodes | exercises | progress |     │    │
│  │  srs_items | streaks | chat_sessions | settings |     │    │
│  │  proposals (新) | skills (新)                         │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、Agent 引擎（核心）

### 3.1 Tool Loop

参考 OpenChatCut 的 `runtime.ts`：一个 `for(;;)` 循环包裹 Vercel AI SDK 的 `streamText`。不用 LangChain（太重），不用 graph framework（没必要）。

```
循环：
  1. 把 system prompt + 历史 + 当前消息喂给 streamText
  2. 流式返回 text（推给 UI）+ tool calls（执行）
  3. 工具执行结果回灌进对话
  4. 如果工具调用了需要审批的 mutating 工具 → 生成 Proposal，暂停等用户
  5. 没有 tool call 或达到 MAX_TOOL_TURNS → 结束
```

### 3.2 Propose → Apply 流水线

参考 OpenChatCut 的 `proposal.ts` + `useAgent.ts`：

```ts
interface Proposal {
  id: string;
  nodeId: string;          // 关联的课程节点
  options: Operation[];     // AI 提议的操作
  status: 'pending' | 'applied' | 'rejected' | 'stale';
  createdAt: string;
}

interface Operation {
  tool: string;             // 哪个工具产生的
  action: string;           // 'update_progress' | 'add_exercise' | 'adjust_plan'...
  target: { nodeId?: string; };
  impact: string;           // 给用户看的人话描述："标记第3节为已掌握"
  rationale: string;        // AI 为什么这么提议
}
```

**应用场景**：
- Course Generator 生成课程树 → 展示成 Proposal，用户调整后应用
- AI Tutor 判定学习者可以跳过某章 → Proposal，学习者确认
- SRS 引擎建议调整复习节奏 → Proposal

**只读操作不走 Proposal**（查询、出题、对话），只有**修改持久状态**的操作才走。

### 3.3 Capability Manifest

参考 OpenChatCut 的 `capabilities.ts`。system prompt 里注入一段：

```
当前能力：
✅ LLM Provider: OpenAI (gpt-4o) 已配置
✅ 学习模式: 苏格拉底模式（已激活）
⬜ 代码 Lab: 未启用（当前课程是文档类型）
✅ SRS: 已启用
✅ 打卡: 已启用（连续 3 天）

学习者水平: 入门
当前课程: Awesome-FDE-Roadmap（文档类型，34 节课）
```

Agent 根据这些真实能力规划教学，不会承诺做不到的事。

### 3.4 Provider 抽象（BYO Key）

直接借鉴 OpenChatCut 的 `shared/llm-providers.ts` 模式：
- 一个 `readonly` 数组定义所有 Provider（id/label/protocol/baseUrl/defaultModel）
- `protocol` 字段（`'anthropic' | 'openai' | 'google' | 'openai-compatible'`）驱动认证头
- 密钥存主进程内存 + 持久化到 SQLite（加密）
- 渲染层只看到布尔值（"已配置"）和模型名，看不到原始 key

---

## 四、Skill 系统（差异化核心）

这是 OpenChatCut 启发下最大的设计升级。**两套并行系统**：

### 4.1 学习模式 Skill（System A，常驻注入）

类似 OpenChatCut 的"创意模式"。学习者选一个，整个 skill 内容注入 system prompt。

**内置学习模式**（v0.1 先做 3-4 个）：

| Skill | 什么时候用 | 核心指令 |
|---|---|---|
| `socratic-mode` | 默认模式，日常学习 | 不直接给答案；用引导性问题；答错降难度 |
| `exam-prep-mode` | 考试冲刺 | 出题计时；不给提示；模拟考试压力 |
| `project-mode` | 项目实战 | 布置动手任务；要求学习者产出；点评产出 |
| `review-mode` | 复习旧知识 | 只出 SRS 到期的题；高频抽查薄弱点 |

**用户自定义**：高级用户可以写自己的学习模式 skill（Markdown + frontmatter），存 SQLite，分享给社区。Agent 自己也能用 `manage_skill` 工具创建（带审批）。

### 4.2 学科知识包 Skill（System B，按需加载）

类似 OpenChatCut 的"插件 skill"。**只把 name + description 放进 prompt**，Agent 需要时调 `load_skill` 加载完整内容。

**例子**：
- `calculus-chain-rule`（微积分链式法则教学要点）
- `python-debugging`（Python 调试工作流）
- `fde-rag-blueprint`（FDE 的 RAG 实施要点）
- `sql-joins`（SQL JOIN 教学法）

这些 skill 是 **Markdown 文件 + frontmatter**，打包在 `skills/` 目录。用 Vite 的 `import.meta.glob('./skills/*/**/*', { query: '?raw', eager: true })` 在构建时注入。

**渐进式披露合约**：
- base prompt：所有 skill 的 `name + description`（一个清单，~500 token）
- on demand：`load_skill(name)` 返回完整 SKILL.md 内容
- 保持 context 小，质量高

### 4.3 Skill 格式

```markdown
---
name: socratic-mode
description: 默认学习模式。不直接给答案，用引导性问题引导学习者自己推导。
type: learning-mode  # learning-mode | subject-pack | user-custom
---

# 苏格拉底模式

## 核心规则
1. 不要直接给答案。先问一个引导性问题。
2. 学习者答错时，指出具体哪一步错，再给一个更小的提示。
3. 学习者连续两次答错，降低难度一档。
4. 学习者主动说"直接告诉我答案"时，可以给，但要追问"你理解了吗"。

## 语气
温暖鼓励，让难懂的题目感觉可亲。参照吴恩达的教学风格。

## 教学循环
讲一个 concept → 立刻出 1 道练习 → 判对错 → 下一个或降难度
```

---

## 五、Lab Adapter 层（可选，学科相关）

**这是 MCP 真正的位置**——不是核心，而是"当学习对象有可动手部分时的增强"。

### 5.1 LabType 检测

Course Generator 导入仓库时自动检测：

```
有 src/ + package.json/requirements.txt → labType = 'code'
有 *.ipynb                              → labType = 'notebook'
只有 *.md                               → labType = 'doc'（默认，绝大多数）
```

### 5.2 三种 Lab Adapter

| Lab | 什么时候用 | AI 能做什么 | v0.1 状态 |
|---|---|---|---|
| `DocLab` | 纯文档仓库（默认） | 无动手环节，纯对话教学 | ✅ 默认 |
| `CodeLab` | 代码仓库 | 通过 MCP 读文件、跑测试、看 diff | ⏳ M5 |
| `NotebookLab` | Jupyter 教程 | 跑单元格、看输出 | 🔜 v0.2 |

### 5.3 MCP 双向桥梁（OpenChatCut 的关键启发）

**LookatStudy 自己也是 MCP server**（不只是 client）。

作为 **client**（CodeLab 场景）：
- AI Tutor 通过 MCP 读学习者的代码仓库，布置实战任务

作为 **server**（外部 agent 集成）：
- 学习者用 Claude Code / Cursor 写作业时，可以通过 MCP 调 LookatStudy 的工具：
  - `lookatstudy_get_today_lesson`
  - `lookatstudy_submit_exercise`
  - `lookatstudy_ask_tutor`
- 学习者不用切换到 LookatStudy 界面，在 IDE 里就能学习

参考 OpenChatCut 的 `server/external-agent/mcp.ts` + `broker.ts` long-poll 模式。

---

## 六、数据模型变更

### 已有的表（M0 实现，不变）

`courses` / `content_nodes` / `exercises` / `progress` / `srs_items` / `streaks` / `chat_sessions` / `settings`

### 新增的表

```sql
-- Skill 存储（内置 + 用户自定义）
skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,  -- 'learning-mode' | 'subject-pack' | 'user-custom'
  body TEXT NOT NULL,  -- 完整 SKILL.md 内容
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
)

-- Proposal 流水线
proposals (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES content_nodes(id) ON DELETE CASCADE,
  operations_json TEXT NOT NULL,  -- Operation[] 数组
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|applied|rejected|stale
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  resolved_at TEXT
)

-- Friction 日志（借鉴 OpenChatCut 的 friction-tools）
-- AI 静默记录学习者卡壳/挫败的时刻，用于自适应难度
friction_log (
  id TEXT PRIMARY KEY,
  node_id TEXT,
  category TEXT NOT NULL,  -- 'confused'|'blocked'|'frustrated'|'agent_error'
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
)
```

### 现有表的变更

```sql
-- courses 加 labType
ALTER TABLE courses ADD COLUMN lab_type TEXT NOT NULL DEFAULT 'doc';
-- 'doc' | 'code' | 'notebook'

-- chat_sessions 加 provider 和 skill 上下文（便于切换 provider 不丢上下文）
ALTER TABLE chat_sessions ADD COLUMN provider TEXT;
ALTER TABLE chat_sessions ADD COLUMN active_skill TEXT;
```

---

## 七、IPC 协议变更

在 `shared/types.ts` 的 `ApiExpose` 新增：

```ts
interface ApiExpose {
  // ... 已有的课程/进度/SRS/streak/settings

  /* Skill 系统 */
  listSkills(type?: SkillType): Promise<Skill[]>
  getSkill(name: string): Promise<Skill | null>
  loadSkillContent(name: string): Promise<string>  // Agent 调用
  setActiveLearningMode(name: string): Promise<void>
  getActiveLearningMode(): Promise<string | null>
  createCustomSkill(skill: Skill): Promise<Skill>  // 用户自建

  /* Proposal 流水线 */
  getPendingProposals(nodeId?: string): Promise<Proposal[]>
  applyProposal(proposalId: string): Promise<void>
  rejectProposal(proposalId: string, reason?: string): Promise<void>

  /* Agent 引擎（替代原来的 tutor:chat） */
  agentChat(nodeId: string, message: string): Promise<AgentResponse>
  agentChatStream(nodeId: string, message: string): Promise<void>

  /* Capability */
  getCapabilities(): Promise<Capabilities>
}
```

---

## 八、与 OpenChatCut 的模式对应关系

| OpenChatCut 模式 | LookatStudy 对应 | 复用程度 |
|---|---|---|
| `runtime.ts` tool loop | Agent 引擎的 tool loop | 直接借鉴结构 |
| `proposal.ts` Propose→Apply | 课程/进度变更的 Proposal | 直接借鉴数据结构 |
| `skills-catalog.ts` 创意模式 | 学习模式 skill（System A） | 模式相同，内容不同 |
| `plugin-skills.ts` 渐进披露 | 学科知识包（System B） | 直接借鉴 import.meta.glob |
| `skill-frontmatter.ts` YAML 解析 | Skill 文件解析 | 可直接移植 |
| `capabilities.ts` 能力清单 | Capability Manifest | 直接借鉴 |
| `client.ts` + `keystore.ts` | Provider 抽象 + 密钥 | 直接借鉴模式 |
| `mcp.ts` + `broker.ts` | LookatStudy 自己当 MCP server | 借鉴架构 |
| `friction-tools.ts` | friction_log 表 | 直接借鉴 |
| `embedded-server.ts` fake Vite | （未来 Web 版复用） | 暂不需要，但预留 |
| `changeLog.ts` Agent undo | 学习进度 rollback | 可借鉴 |

---

## 九、掌握度追踪模型（v3 新增，M2 实现）

### 为什么需要

SM-2 只知道"什么时候复习"，不知道"学习者到底懂不懂"。
真正的 AI 导师必须能回答：学习者**懂了**什么？**误解了**什么？下一步该教什么？

### v0.1：BKT（贝叶斯知识追踪）

**为什么 BKT 而非 IRT**：IRT 需要几百次答题才能让参数收敛。新用户答 5 题，IRT 估出来是噪声。BKT 有先验概率，第一次答题就工作。

**算法**（~50 行 TypeScript）：

每个知识点（concept node）维护一个 `P(掌握)` ∈ [0, 1]。

四个参数（参考文献默认值，后续可调）：
- `P(L0)` = 0.1（初始掌握概率，假设一开始没掌握）
- `P(T)` = 0.1（没掌握→一次练习后掌握的转移概率）
- `P(S)` = 0.2（掌握了但答错的概率——粗心）
- `P(G)` = 0.2（没掌握但答对的概率——蒙对）

**更新公式**（每次答题后）：

```
答对时：
  P(掌握|答对) = P(G)·P(没掌握) + P(答对) → 归一化
答错时：
  P(掌握|答错) = P(S)·P(掌握) + P(答错) → 归一化

更新后：
  P(掌握) ← P(掌握|答题结果) · (1 - P(T)) + P(T)
```

**数据模型变更**：

```sql
-- 扩展 progress 表（已有，加一列）
ALTER TABLE progress ADD COLUMN mastery REAL NOT NULL DEFAULT 0.1;
-- mastery = P(掌握)，0-1 浮点
```

或单独表（如果不想改 progress）：
```sql
CREATE TABLE knowledge_state (
  node_id TEXT PRIMARY KEY REFERENCES content_nodes(id) ON DELETE CASCADE,
  mastery REAL NOT NULL DEFAULT 0.1,
  total_attempts INTEGER NOT NULL DEFAULT 0,
  correct_attempts INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT
);
```

**Agent 怎么用**：
- 出题时：读 `mastery` 低的节点，优先出题
- 追问时：针对 `mastery < 0.7` 的节点追问
- Capability manifest 注入："学习者当前最薄弱的 3 个知识点：[...]"

### v0.2：IRT 升级

当有 500+ 答题记录后，参数估计能收敛。IRT 引入：
- 题目难度参数 β（每道题有自己的难度）
- 学习者能力参数 θ（不只是一个 P(掌握)，而是连续能力值）
- 能区分"难题答对"（θ 高）vs"易题答对"（信息量少）

**升级路径**：BKT 表保留，加 `item_difficulty` 表，IRT 在 BKT 之上做更精细估计。

---

## 十、轻量 RAG 层（v3 新增，M3 实现）

### 为什么需要

学习者跨章节提问时（"链式法则在哪节讲过？""RAG 和 evals 的关系是什么？"），`content_nodes.content` 的预缓存不够——它是按节点存的，不检索。

### v0.1：SQLite FTS5 全文检索

**不上海量向量库**。v0.1 内容规模小（一个 README 几 KB），全文塞进 LLM context 就够。但"在哪节课讲过"这种检索，FTS5 够用。

**实现**（~1 天）：

```sql
-- 在 content_nodes.content 上建 FTS5 虚拟表
CREATE VIRTUAL TABLE content_fts USING fts5(
  content,
  content='content_nodes',
  content_rowid='rowid'
);
-- 或简单点：LIKE 查询，性能在 v0.1 规模可接受
```

**Agent 工具**：
```ts
{
  name: "search_content",
  description: "在课程内容里搜索某个概念出现在哪些节点",
  parameters: { query: string }
}
// 返回匹配的 node_id + title + 片段
```

**中文分词**：FTS5 的默认分词对中文不友好。v0.1 先用 LIKE 兜底，FTS5 配置留优化。如果中文检索质量差，v0.2 加 jieba 或换 trigram。

### v0.2：完整 RAG

**触发条件**：用户频繁跨章节提问，或单个仓库 > 100KB。

- 向量库（sqlite-vss 或外部）
- BM25 关键词
- reranker（cross-encoder）
- 借鉴 DeepTutor 的 `services/rag/pipeline.py` 的 fluent API 设计

---

## 十一、记忆系统（v3 新增，M3 实现）

### 为什么需要

借鉴 DeepTutor 的 `SUMMARY.md` + `PROFILE.md` 模式。跨会话保留"学习者是谁、学到哪了、哪里卡过"。

### 实现（~1 天）

Agent 自维护两个 Markdown 字符串，存在 `settings` 表或单独的 `memory` 表：

```
key: "learner_summary"
value: |
  学习历程摘要（agent 每次会话结束时更新）：
  - 2026-08-06：学了 FDE 路线图的 RAG Blueprint 章节，掌握度 0.72
  - 在 RAG 的向量库选型上卡过（friction: confused）
  - 掌握良好：SM-2 调度（0.91）
  - 薄弱：Enterprise RAG 的合规要求（0.34）
```

```
key: "learner_profile"
value: |
  学习者画像：
  - 水平：中级（能理解 SQL，但对分布式系统陌生）
  - 偏好：喜欢动手实例，不喜欢纯理论
  - 目标：3 周内学完 FDE 路线图
  - 学习模式偏好：苏格拉底式
```

**更新时机**：每次会话结束时（不是每轮），agent 调 `update_memory` 工具重写。控制成本。

**注入 system prompt**：作为 volatile 块（最后），让 agent 知道"这是谁、学到哪了"。

**配合 friction_log**：friction 记录的是**瞬时**信号（这次卡了），SUMMARY 记录的是**累积**信号（总共在这些地方卡过 N 次）。互补。


详细清单见 `docs/OPENCHATCUT-PATTERNS.md`。
