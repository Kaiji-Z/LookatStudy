# LookatStudy 架构设计

> 核心思想：**一个通用 Agent 引擎 + Skill 驱动 + 可选 Lab Adapter**。
> 引擎本身不"知道"在教什么学科——教学法、学科知识、审批策略全部由可插拔的 Skill 决定。

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
2. 操作被捕获成 `Proposal{ operations: Operation[] }`
3. UI 展示"AI 想做这些修改"
4. 学习者点"应用" / "拒绝"

**为什么**：教育产品的信任成本极高。家长/学习者必须能预览 AI 的所有改动。这是"AI 起草、人确认提交"原则的工程化。

### 原则 3：渐进式披露（Progressive Disclosure）

系统 prompt 永远只包含**最小必要信息**：
- 所有 skill 的 name + description（一个清单）
- 当前激活的 skill 的完整内容
- 当前能力清单（capability manifest）

详细的学科知识、练习题模板、教学脚本——**按需加载**。Agent 讲到某个知识点时，调 `load_skill` 工具拉取详细内容。

**为什么**：context window 是稀缺资源。把几十个学科的详细教学法全塞进 prompt 会爆 token 且降低质量。只放清单 + 按需加载，保持 context 小、质量高。

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
│  │  skills | proposals | friction_log | memory           │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、Agent 引擎（核心）

### 3.1 Tool Loop

一个包裹 Vercel AI SDK `streamText` 的循环。不依赖重型 agent 框架——一个最小 loop 足够：

```
循环：
  1. 把 system prompt + 历史 + 当前消息喂给 streamText
  2. 流式返回 text（推给 UI）+ tool calls（执行）
  3. 工具执行结果回灌进对话
  4. 如果工具调用了需要审批的 mutating 工具 → 生成 Proposal，暂停等用户
  5. 没有 tool call 或达到 step 上限 → 结束
```

实现：`src/main/services/agent/agent-engine.ts`，用 AI SDK v5 的 `stopWhen: stepCountIs(N)` 控制循环上限。

### 3.2 Propose → Apply 流水线

```ts
interface Proposal {
  id: string;
  nodeId: string | null;
  operations: LearningOperation[];
  status: 'pending' | 'applied' | 'rejected' | 'stale';
  rationale: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface LearningOperation {
  type: 'update_mastery' | 'mark_mastered' | 'set_node_status' | 'add_to_srs';
  nodeId: string;
  correct?: boolean;   // for update_mastery
  status?: NodeStatus; // for set_node_status
  quality?: number;    // for add_to_srs
}
```

**应用场景**：
- AI Tutor 判定学习者答对/答错 → Proposal 提议更新掌握度（BKT），学习者确认后落库
- AI Tutor 判定学习者掌握了某节 → Proposal 提议 mark_mastered，学习者可拒绝
- Course Generator 生成课程树 → 提议结构，用户调整后应用

**只读操作不走 Proposal**（查询、出题、对话），只有**修改持久状态**的操作才走。部分失败 → `stale` + applyError，已执行的不回滚（部分应用语义对学习场景更友好）。

### 3.3 Capability Manifest

system prompt 里注入当前真实能力，让 Agent 据此规划教学，不承诺做不到的事：

```
当前能力：
✅ LLM Provider: GLM (glm-4-flash) 已配置
✅ 学习模式: 苏格拉底模式（已激活）
⬜ 代码 Lab: 未启用（当前课程是文档类型）
✅ SRS: 已启用
✅ 打卡: 已启用（连续 3 天）

学习者水平: 入门
当前课程: Awesome-FDE-Roadmap（文档类型，34 节课）
```

### 3.4 Provider 抽象（BYO Key）

- 一个 readonly 预设数组定义所有 Provider（id/label/baseUrl/defaultModel/apiKeySetting），见 `src/main/services/agent/llm-presets.ts`
- 全部走 OpenAI-compatible 协议（`@ai-sdk/openai` 的 `createOpenAI` 自定义 baseURL），覆盖 GLM / OpenAI / DeepSeek
- 密钥只存在主进程（settings 表），渲染层只见布尔值（"已配置"）和模型名，看不到原始 key——这是项目的安全边界

---

## 四、Skill 系统（差异化核心）

**两套并行系统**：

### 4.1 学习模式 Skill（System A，常驻注入）

学习者选一个，整个 skill 内容注入 system prompt。

**内置学习模式**：

| Skill | 什么时候用 | 核心指令 |
|---|---|---|
| `socratic-mode` | 默认模式，日常学习 | 不直接给答案；用引导性问题；答错降难度 |
| `exam-prep-mode` | 考试冲刺 | 出题计时；不给提示；模拟考试压力 |
| `project-mode` | 项目实战 | 布置动手任务；要求学习者产出；点评产出 |
| `review-mode` | 复习旧知识 | 只出 SRS 到期的题；高频抽查薄弱点 |

**用户自定义**：高级用户可以写自己的学习模式 skill（Markdown + frontmatter），存 SQLite。Agent 自己也能用 `skill:create` 工具创建。

### 4.2 学科知识包 Skill（System B，按需加载）

**只把 name + description 放进 prompt**，Agent 需要时调 `load_skill` 加载完整内容。

**例子**：
- `calculus-chain-rule`（微积分链式法则教学要点）
- `python-debugging`（Python 调试工作流）
- `sql-joins`（SQL JOIN 教学法）

这些 skill 是 **Markdown 文件 + frontmatter**，打包在 `skills/` 目录，构建时用 Vite 的 `import.meta.glob` 注入。

**渐进式披露合约**：
- base prompt：所有 skill 的 `name + description`（一个清单，~500 token）
- on demand：`load_skill(name)` 返回完整 SKILL.md 内容

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

## 教学循环
讲一个 concept → 立刻出 1 道练习 → 判对错 → 下一个或降难度
```

---

## 五、Lab Adapter 层（可选，学科相关）

### 5.1 LabType 检测

Course Generator 导入仓库时自动检测内容类型：

```
有 python/js/go/rust 等代码块  → labType = 'code'
有 .ipynb / jupyter 关键词      → labType = 'notebook'
纯 markdown                     → labType = 'doc'（默认，绝大多数）
```

### 5.2 三种 Lab Adapter

| Lab | 什么时候用 | AI 能做什么 | 状态 |
|---|---|---|---|
| `DocLab` | 纯文档仓库（默认） | 无动手环节，纯对话教学 | ✅ |
| `CodeLab` | 代码仓库 | 读文件、跑测试、看 diff | 🔜 后续 |
| `NotebookLab` | Jupyter 教程 | 跑单元格、看输出 | 🔜 后续 |

---

## 六、数据模型

12 张表（schema.sql 是唯一真相，schema.ts 派生）：

`courses` / `content_nodes` / `exercises` / `progress` / `srs_items` / `streaks` / `chat_sessions` / `settings` / `skills` / `proposals` / `friction_log` / `memory`。

几个关键非平凡字段：
- `progress.mastery REAL` —— BKT 掌握度概率 0-1（NULL=从未评估）
- `courses.lab_type TEXT` —— `doc` / `code` / `notebook`，决定 Lab Adapter
- `proposals.operations_json` —— `LearningOperation[]` 序列化
- `memory(category, node_id, summary)` —— global / node / friction_pattern 三类

---

## 七、IPC 协议

`shared/types.ts` 的 `ApiExpose` 接口是契约，编辑它 = 编辑协议，两端（preload + main handlers）必须同步。通道命名 `domain:action`。完整清单见 `src/main/ipc/index.ts`。

主要域：`course:*` / `progress:*` / `srs:*` / `streak:*` / `skill:*` / `agent:*` / `proposal:*` / `dashboard:*` / `search:*` / `memory:*`。

---

## 八、掌握度追踪模型

### v0.1：BKT（贝叶斯知识追踪）

**为什么 BKT 而非 IRT**：IRT 需要几百次答题才能让参数收敛。新用户答 5 题，IRT 估出来是噪声。BKT 有先验概率，第一次答题就工作。

**算法**（`src/main/services/pure/bkt.ts`，~50 行）：

每个知识点维护一个 `P(掌握)` ∈ [0, 1]。四个参数（文献默认值）：
- `P(L0)` = 0.5（初始掌握概率）
- `P(T)` = 0.1（没掌握→一次练习后掌握的转移概率）
- `P(S)` = 0.1（掌握了但答错的概率——粗心）
- `P(G)` = 0.2（没掌握但答对的概率——蒙对）

每次答题后贝叶斯更新后验，再做学习迁移。

**Agent 怎么用**：
- 出题时：读 `mastery` 低的节点，优先出题
- 追问时：针对 `mastery < 0.7` 的节点追问
- Capability manifest 注入："学习者当前最薄弱的 3 个知识点：[...]"

### v0.2：IRT 升级

当有 500+ 答题记录后，参数估计能收敛。IRT 引入：
- 题目难度参数 β（每道题有自己的难度）
- 学习者能力参数 θ（连续能力值）
- 能区分"难题答对"（θ 高）vs"易题答对"（信息量少）

**升级路径**：BKT 表保留，加 `item_difficulty` 表，IRT 在 BKT 之上做更精细估计。

---

## 九、轻量 RAG 层（M3）

### 为什么需要

学习者跨章节提问时（"链式法则在哪节讲过？"），`content_nodes.content` 按节点存，不检索。

### v0.1：LIKE 全文检索

**不上海量向量库**。v0.1 内容规模小，全文检索够用。

实现：`src/main/services/search-service.ts`，用原生 sqljs `exec` 跑 `LIKE '%query%'`，多关键词 AND 组合，手工截 snippet。

> 注：理想方案是 SQLite FTS5，但 sql.js 的 WASM 构建不含 fts5 模块（`CREATE VIRTUAL TABLE ... USING fts5` 会报 `no such module`）。v0.1 用 LIKE 兜底，v0.2 换含 fts5 的 SQLite 构建后升级为 FTS5 + BM25 排序。

**Agent 工具**：`search_content(query)` 返回匹配的 nodeId + title + 片段。

**中文**：v0.1 用 LIKE 子串匹配（中文够用）。如果质量差，v0.2 加 jieba 或换 trigram。

### v0.2：完整 RAG

**触发条件**：用户频繁跨章节提问，或单个仓库 > 100KB。

- 向量库（sqlite-vss 或外部）
- BM25 关键词
- reranker（cross-encoder）

---

## 十、记忆系统（M3）

### 为什么需要

跨会话保留"学习者是谁、学到哪了、哪里卡过"。

### 实现

`memory` 表，三类 category：
- `global` —— 学习者画像（nodeId=null，全局）
- `node` —— 某节点的学习历程摘要
- `friction_pattern` —— 在某节点反复卡壳的模式

Agent 每次会话结束时调 `memory:update` 重写（不是每轮，控制成本）。注入 system prompt 让 agent 知道"这是谁、学到哪了"。

**配合 friction_log**：friction 记录**瞬时**信号（这次卡了），memory 记录**累积**信号（总共在这些地方卡过 N 次）。互补。
