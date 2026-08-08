# LookatStudy v0.2 — UI 重大升级设计规划

> 产物:impeccable skill 基于三份调研报告(Agentic Patterns / 嵌入式 AI SDK / 同类学习产品)+ 现状代码 + PRODUCT.md(register=Product, color=Committed, dark-first #58cc02)产出。
> 适用范围:renderer 层 UI 重大升级,主进程 IPC/DB 改动最小化。
> 实施原则:**earned trust, not surprise**。 Familiarity is a feature。

---

## 0. 升级灵魂(一句话)

> **让 AI 从"旁边的 chat 等用户点"变成"嵌入学习流程的上下文内联导师",并用 Generative UI 把 AI 的产出从灰字气泡升级为可交互的学习产物。**

三份调研交叉验证的核心痛点:你的 AI 是"被动 chatbot"(Khanmigo 失败模式),tool call 是一行灰字(浪费 AI SDK 栈),技能树是网状 zig-zag 而 SM-2 复习被孤立成 tab(违反 Duolingo 2022 重构结论)。

---

## 1. 设计理念

### 1.1 三条不变的底线(来自 PRODUCT.md + product register)

1. **工具消失于任务** —— 用户专注学习,不是欣赏 UI。一致性 > 惊喜。同一个按钮形状、同一套表单控件、同一个图标风格。
2. **克制可见的 AI** —— AI 默认隐身做背景工作,只在用户注意力已停留处浮现(嵌入式设计"上下文内联"原则)。从不主动弹窗轰炸。
3. **诚实可逆** —— 每个 AI 决策内联说明"为什么",始终提供一键撤销/手动覆盖。

### 1.2 三条 v0.2 新确立的原则

4. **AI 嵌入流程,不靠 chat 等用户点** —— 答题反馈自动触发 AI 解释(Duolingo "Explain My Answer");Cmd+K 命令面板调起"用大白话解释/出 3 道题/对比 A vs B";知识点停留 N 秒触发内联帮助卡。
5. **Generative UI 是产物,不是文字** —— AI 选 tool(不写代码),tool execute 读 sql.js 返回数据,前端预注册的 React 组件按 part.type 渲染。产物可独立查看/保存/复习。
6. **路径即复习** —— SM-2 复习节点交错插入主路径(Duolingo 路径内 interleaving),复习在视觉上是"前进而非倒退"。复习面板用四象限分组(overdue 突出),单次 session 封顶 10 题防积压劝退。

---

## 2. 信息架构:三栏布局

### 2.1 从双栏到三栏

```
┌─────────────────────────────────────────────────────────────────────┐
│ Header  Logo · 课程名 · 课程选择器       XP条 · 🔥连击 · 主题 · 设置│
├──────────────┬──────────────────────────┬───────────────────────────┤
│              │                          │                           │
│  导航栏       │   AI 对话流(中)          │   产物面板(右)            │
│  (左,16%)    │   (中,42%)                │   (右,42%,可折叠)         │
│              │                          │                           │
│  · 学习路径   │   流式消息 + parts 渲染   │   · 默认:当前节点内容     │
│  · 仪表盘     │   · thinking 可折叠      │   · AI 产出时:产物        │
│  · 导入       │   · tool 卡片(内联)     │     (思维导图/对比表/      │
│  · (设置)     │   · proposal 卡(内联)   │      练习卡/代码标注)      │
│              │                          │   · 标签页:内容/产物/复习 │
│              │                          │                           │
│              │   ───────────────────    │                           │
│              │   [输入框] [🎤][📎][⏎]    │                           │
│              │   starter prompts 横条    │                           │
└──────────────┴──────────────────────────┴───────────────────────────┘
```

### 2.2 每栏的精确职责

| 栏 | 宽度 | 职责 | 关键组件 |
|---|---|---|---|
| **导航栏(左)** | 16%(min 200px,max 280px) | 全局导航 + 课程/路径概览 + 复习入口 | `NavRail`(icon nav)+ `PathOverview`(迷你路径缩略图,点击跳转)+ 复习徽章(overdue 数) |
| **AI 对话流(中)** | 42% | AI 导师对话 + 工具/proposal 卡 + 输入 | `ChatStream`(parts-based)+ `ChatComposer`+ starter 横条 + Cmd+K 命令面板 |
| **产物面板(右)** | 42%(可折叠到 0) | 默认显示当前节点内容;AI 产出时动态切换产物 | `ArtifactPanel`(标签页:内容/产物/复习)+ Generative UI 产物组件 |

**关键决策**:把现有"💬对话/📝练习/⚙️设置"三 tab **拆解**——
- "对话"+"练习"合并进**中栏 AI 对话流**(练习题作为一种 tool 产出的 Generative UI,直接出现在对话里,不再单独 tab)。
- "设置"移到**Header 右上角齿轮**(全局,不属于学习流程,不该常驻左栏 tab)。
- 现有右栏"技能树/仪表盘/导入"三 tab 移到**左导航栏**作为视图切换;右栏解放给"内容 + 产物"。

### 2.3 现有 ChatPanel 拆解映射

| 现有 ChatPanel 元素 | v0.2 去向 |
|---|---|
| 💬对话/📝练习/⚙️设置 三 tab | 对话+练习→中栏(合并);设置→Header 齿轮 |
| 学习模式 pill(苏格拉底/考试/项目/复习) | 中栏输入框上方(保留,但默认收起为"模式:苏格拉底 ▾"下拉) |
| 消息流(user/assistant/tool/proposal) | 中栏 `ChatStream`,升级为 parts-based 渲染 |
| starter prompts 横条 | 中栏输入框上方(保留) |
| 输入框 + 发送/停止 | 中栏底部 `ChatComposer` |

---

## 3. 关键 Surfaces 详细设计

### 3.1 Surface A:导航栏(左)

```
┌──────────────────┐
│ 📚 LookatStudy   │  ← Logo + 应用名(可点击回首页)
├──────────────────┤
│ ▣ 学习路径       │  ← 当前视图(active 绿底)
│ ◫ 仪表盘         │
│ ⊕ 导入仓库       │
├──────────────────┤  ← 分隔
│ 当前课程         │
│ ┌──────────────┐ │
│ │ 迷你路径     │ │  ← PathOverview:垂直缩略,当前节点高亮
│ │ ●━━●━━◉━━○  │ │     点击任意节点跳转(只读概览)
│ │     ╲╲      │ │     "◉"=current,"●"=mastered,"○"=locked
│ └──────────────┘ │
├──────────────────┤
│ 📖 复习(3 待)  │  ← overdue 计数红点,点击进复习视图
│ 🔥 7 天连击      │  ← 迷你连击(可选)
└──────────────────┘
```

**设计要点**:
- 导航栏始终可见,提供"我在哪、我能去哪"的方向感(Brilliant 的"clear direction + freedom")。
- `PathOverview` 是**只读缩略图**,不是主交互区——主交互在产物面板的"内容"标签。避免两处可点同一棵树造成认知混乱。
- 复习徽章只在 overdue>0 时显示红点数字。

### 3.2 Surface B:AI 对话流(中)—— parts-based 渲染

这是本次升级**最核心**的改造。消息从"字符串拼接"升级为 `parts[]` 数组渲染。

**Part 类型映射表**(对齐 AI SDK v5 `message.parts`):

| part.type | 渲染组件 | 视觉 |
|---|---|---|
| `text` | `TextPart` → ReactMarkdown | 扁平全宽段落(非 SMS 气泡),左对齐,最大 65ch |
| `reasoning` | `ReasoningPart`(可折叠) | 答案上方灰底折叠区,默认折叠,标签"思考过程"(诚实命名) |
| `tool-get_node_info` | `ToolPart`(只读信息) | 内联浅灰卡:📍 节点信息 + 掌握度 |
| `tool-record_answer` | `ProposalCard`(应用/拒绝) | 绿边卡:📋 提议更新掌握度 + ✓应用/✕拒绝 |
| `tool-mark_mastered` | `ProposalCard` | 同上 |
| `tool-show_concept_map`(新) | `ConceptMapArtifact` → 右栏产物 | 对话里显示"🗺️ 已生成概念图 →"(点击右栏聚焦) |
| `tool-generate_quiz`(新) | `QuizArtifact` → 右栏产物 | 对话里显示"📝 已出 3 道题 →" |
| `tool-compare_table`(新) | `CompareTableArtifact` → 右栏产物 | 对话里显示"📊 已生成对比表 →" |
| `error` | `ErrorPart` | 红底卡 + 排查提示 |

**消息视觉规范**(执行 Setproduct 反模式禁令):
- ❌ 不用 SMS 气泡(现有 user 绿圆角气泡、assistant 灰圆角气泡 → 改为扁平全宽)
- ✅ user 消息:左 4px 绿色竖条 + 全宽浅绿底(#58cc02 10% 透明)
- ✅ assistant 消息:全宽无背景,直接段落,带小号 "AI" 头像在左侧(7×7 圆)
- ✅ tool/reasoning:缩进 + 浅灰底折叠卡
- ✅ 流式光标:单字符闪烁,不人为限速

**ReasoningPart 折叠规范**(Cursor 真痛点):
```
┌─────────────────────────────────────┐
│ ▸ 思考过程                  (1.2s)  │  ← 折叠态,点击展开
└─────────────────────────────────────┘
        ↓ 点击展开
┌─────────────────────────────────────┐
│ ▾ 思考过程                  (1.2s)  │
│   用户问的是 X,我需要先查节点信息 │
│   再判断掌握度...                  │
└─────────────────────────────────────┘
```

### 3.3 Surface C:产物面板(右)—— Generative UI

**核心机制**:右栏是"工作台",内容随上下文动态切换。

**三标签页**:
1. **内容**(默认):当前节点的 markdown 讲解(从 `node.content`)。代码块可标注、可"解释这段"。
2. **产物**:当 AI 调用展示型 tool 时,产物出现在这里。多个产物可堆叠(tab 切换)。
3. **复习**:点"📖 复习"时切换到此 tab,显示四象限复习面板(见 Surface E)。

**产物生命周期状态机**:
```
generating(骨架) → ready(真实组件) → error(错误态)
     ↓ 交互
saved(保存到 sql.js) / dismissed(关闭)
```

**ConceptMapArtifact 示例**:
```
┌─ 🗺️ 概念图 · "Transformer 架构" ──────┐
│                                       │
│     [Embedding]                       │
│         ↓                             │
│     [Attention]←→[Multi-Head]         │
│         ↓                             │
│     [Feed Forward]                    │
│         ↓                             │
│     [Layer Norm]                      │
│                                       │
│  📌 已保存到节点   ⟳ 重新生成  ✕     │
└───────────────────────────────────────┘
```

**QuizArtifact(对话内练习)**:
```
┌─ 📝 练习题 · 第 2/3 题 ────────────────┐
│ Q: Transformer 中 Multi-Head 的作用? │
│ ┌───────────────────────────────────┐ │
│ │ A. 减少参数量                      │ │
│ │ B. 捕获不同子空间注意力 (选中)     │ │
│ │ C. 加速训练                        │ │
│ └───────────────────────────────────┘ │
│              [提交答案]                │
└───────────────────────────────────────┘
```

### 3.4 Surface D:答题反馈流(AI 嵌入流程的核心)

**触发**:练习题提交后,无论对错都自动触发 AI 解释(Duolingo "Explain My Answer")。

```
中栏对话流(答题后):
┌─────────────────────────────────────┐
│ ▾ AI 导师                           │
│   你答对了 B。                      │
│   Multi-Head 之所以有效,是因为... │
│                                     │
│   📋 提议更新掌握度(答对):         │
│       基于本次观测,掌握度 +0.15   │
│       [✓ 应用]  [✕ 拒绝]            │
│                                     │
│   💡 想深入? 我可以:                │
│      [出变体题] [画概念图] [对比表] │
└─────────────────────────────────────┘
```

**关键**:答错时 AI 用苏格拉底式提问(不直接给答案),引导重新思考。

### 3.5 Surface E:复习面板(四象限 + 队列封顶)

**触发**:导航栏"📖 复习(N 待)"或仪表盘"开始复习"。

```
右栏产物面板 → 复习标签:
┌─────────────────────────────────────┐
│ 今日复习                  [×退出]   │
├─────────────────────────────────────┤
│ 🔴 逾期(3)  │ 🟡 短期(5)          │  ← 四象限分组
│ ────────────┼──────────────         │     overdue 红色突出
│ · 节点 A    │ · 节点 D              │
│ · 节点 B    │ · 节点 E              │
│ · 节点 C    │                       │
├─────────────┼───────────────────────┤
│ 🟢 长期(2)  │ ⚪ 待激活(1)         │
│ ────────────┼──────────────         │
│ · 节点 F    │ · 节点 H              │
│ · 节点 G    │                       │
├─────────────────────────────────────┤
│ 本次队列:3/10  [开始复习 →]         │  ← 单次封顶 10 题
└─────────────────────────────────────┘
```

复习卡片采用**自评 + 算法双层**(Memrise/olgaskuja 案例教训):
- 客观题(选择/填空):系统判分
- 开放式(讲解后自评):三档 `再来一次 / 记住了 / 完全掌握` 驱动 SM-2

### 3.6 Surface F:命令面板(Cmd+K)

**触发**:全局 Cmd+K / Ctrl+K(AGENTS.md 现有快捷键已占,需调整:Cmd+K 改为命令面板,Cmd+L 切换路径)。

```
┌─────────────────────────────────────┐
│ 🔍 输入指令或问题...                │
├─────────────────────────────────────┤
│ 💡 基于当前节点:                    │
│   ▸ 用大白话解释这一节              │
│   ▸ 出 3 道练习题                   │
│   ▸ 和上一节做对比表                │
│   ▸ 画个概念图帮我理清              │
├─────────────────────────────────────┤
│ 🎯 学习模式:                        │
│   ▸ 切到苏格拉底模式                │
│   ▸ 切到考试冲刺                    │
├─────────────────────────────────────┤
│ 🧭 导航:                            │
│   ▸ 跳到下一课                      │
│   ▸ 打开仪表盘                      │
└─────────────────────────────────────┘
```

---

## 4. 颜色语义规范(严格化)

**核心原则**:每种颜色有专属语义,绝不混用。来自 olgaskuja 颜色规范 + PRODUCT.md committed green 策略。

| 颜色 | Token | 专属用途 | 禁止用于 |
|---|---|---|---|
| **绿 #58cc02** | `brand` | 进度前进 / 正确 / 主操作 / 当前选中 | ❌ 装饰、链接、警告 |
| **蓝 #1cb0f6** | `accent` | 可交互(链接、可点击文字、二级操作) | ❌ 进度、掌握、错误 |
| **金 #ffc800** | `gold` | 掌握(mastery、crown、王冠等级) | ❌ 进度、交互 |
| **橙红 #ff4b4b** | `warning` | 逾期(overdue)/ 警告 / 错误答案 | ❌ 进度、掌握 |
| **中性灰阶** | `neutral-50..950` | 背景、文本、边框、禁用 | — |

**状态语义词汇**(product register 要求完整覆盖):
`default / hover / focus(active ring) / active / disabled / loading / error / warning / success / info`

**暗色优先**:neutral-950 基底,亮色模式 neutral-50 基底。所有颜色在两种模式下都通过 ≥4.5:1 对比度(body)/ ≥3:1(大字)。

**移除的反模式**:
- ❌ `bubble-pulse` 动画无限循环(overdue 节点用静态红点,不用脉冲——product register 禁"装饰性 motion")
- ❌ 到处彩虹色(SRS 平台案例的"蓝色专属可点击"严格执行)
- ❌ gems/虚拟货币/loot 动画(streak creep dark pattern)

---

## 5. 动效规范

**铁律**(PRODUCT.md + product register):150-250ms,状态变化 only,无装饰编排。

| 动效 | 时长 | 曲线 | 用途 |
|---|---|---|---|
| `msg-enter` | 200ms | ease-out | 消息入场(opacity + translateY 8px) |
| `tab-slide` | 150ms | ease-out | 标签切换 |
| `lesson-bubble-hover` | 200ms | ease-out | 路径节点 hover(scale 1.05) |
| `panel-collapse` | 200ms | ease-out | 产物面板折叠 |
| `reasoning-expand` | 150ms | ease-out | 思考过程折叠展开 |
| `artifact-render` | 250ms | ease-out | Generative UI 产物入场 |

**移除/改造的动效**:
- ❌ `bubble-pulse` 2s 无限循环 → 移除(违反"motion 传达状态非装饰")。overdue 节点用静态视觉(颜色 + 标签)。
- ❌ `flame-flicker` 1.5s 无限循环 streak 火焰 → 移除。连击用静态 🔥 + 数字。
- ✅ 保留 `typing-dot` 流式指示(传达"AI 工作中"状态)
- ✅ 所有动效保留 `prefers-reduced-motion: reduce` 降级(现有 CSS 已有,保留)

---

## 6. 组件层级(复用 / 新建 / 重构)

### 6.1 复用(改造即可)

| 现有组件 | v0.2 改造 |
|---|---|
| `Header` | 简化:课程选择器移左栏,设置入口加齿轮图标 |
| `ExercisePanel` | 拆解:题型选择器→命令面板,题目卡片→QuizArtifact(Generative UI) |
| `ImportView` | 移到左栏导航项,内容不变 |
| `DashboardView` | 保留,移到左栏导航项 |

### 6.2 新建

| 新组件 | 职责 | 文件 |
|---|---|---|
| `NavRail` | 左栏导航 + PathOverview | `components/NavRail.tsx` |
| `PathOverview` | 迷你路径缩略图(只读) | `components/PathOverview.tsx` |
| `ChatStream` | parts-based 消息流(替代现有消息渲染) | `components/ChatStream.tsx` |
| `ChatComposer` | 输入框 + 模式选择 + 命令面板入口 | `components/ChatComposer.tsx` |
| `CommandPalette` | Cmd+K 命令面板 | `components/CommandPalette.tsx` |
| `ArtifactPanel` | 右栏产物面板(三标签) | `components/ArtifactPanel.tsx` |
| `ReasoningPart` | 思考过程折叠卡 | `components/parts/ReasoningPart.tsx` |
| `ToolPart` | 通用 tool 调用卡 | `components/parts/ToolPart.tsx` |
| `ConceptMapArtifact` | 概念图产物 | `components/artifacts/ConceptMapArtifact.tsx` |
| `QuizArtifact` | 对话内练习产物 | `components/artifacts/QuizArtifact.tsx` |
| `CompareTableArtifact` | 对比表产物 | `components/artifacts/CompareTableArtifact.tsx` |
| `ReviewPanel` | 四象限复习面板 | `components/ReviewPanel.tsx` |
| `ExplainCard` | 答题后 AI 解释卡(嵌入流程) | `components/ExplainCard.tsx` |

### 6.3 重构

| 现有组件 | 重构方向 |
|---|---|
| `ChatPanel` | 拆解为 ChatStream + ChatComposer;设置移出;练习并入 ChatStream 的 QuizArtifact |
| `LessonBubble`(在 App.tsx 内) | 提取为独立组件;移除 bubble-pulse;支持线性路径渲染(见 M2) |
| `SectionUnit`(在 App.tsx 内) | 改造为线性单路径渲染(替代 zig-zag);复习节点交错插入 |

---

## 7. 新增 tool 清单(Generative UI 落地)

现有 3 个 tool(get_node_info / record_answer / mark_mastered)。新增**展示型 tool**(execute 只返回数据,前端预注册组件渲染):

| tool 名 | execute 返回 | 渲染组件 | 用途 |
|---|---|---|---|
| `show_concept_map` | `{nodes:[],edges:[],title}` | ConceptMapArtifact | 画概念图理清结构 |
| `generate_quiz` | `{questions:[{prompt,options,answer,explain}]}` | QuizArtifact | 对话内出题 |
| `compare_table` | `{headers:[],rows:[],title}` | CompareTableArtifact | A vs B 对比 |
| `draw_diagram` | `{mermaid:"..."}` | MermaidArtifact | 流程图/时序图(mermaid 渲染) |
| `show_code_walkthrough` | `{code,annotations:[]}` | CodeWalkthroughArtifact | 代码逐行讲解 |

**安全模型**:模型只选 tool + 提供 input(zod schema 校验),绝不写代码。execute 读 sql.js 或纯计算返回数据,组件由前端预注册。契合 AGENTS.md "Renderer never touches DB/API keys"——tool 在主进程 execute。

---

## 8. 流式协议升级(技术硬骨头 #1)

### 8.1 现状问题

`agent-engine.ts` 只接了 `text-delta`,tool call 走 `onToolCall` 回调推 `chat:toolCall` 一行灰字。**无法支撑 parts-based 渲染和 Generative UI**。

### 8.2 升级方案

**主进程**(agent-engine.ts):
```typescript
for await (const part of result.fullStream) {
  if (part.type === "text-delta") {
    win?.webContents.send("chat:part", { type: "text", text: part.text });
  } else if (part.type === "reasoning") {  // 新增
    win?.webContents.send("chat:part", { type: "reasoning", text: part.text });
  } else if (part.type === "tool-input-start") {  // 新增
    win?.webContents.send("chat:part", { type: "tool-start", toolName: part.toolName });
  } else if (part.type === "tool-result") {  // 新增
    win?.webContents.send("chat:part", {
      type: "tool-result",
      toolName: part.toolName,
      output: part.output,  // ← Generative UI 数据
    });
  }
}
```

**IPC 契约**(shared/types.ts IpcEvents):
```typescript
// 新增
"chat:part": (part: ChatPart) => void;
// 保留(过渡期兼容)
"chat:token": (chunk: string) => void;
```

**渲染层**:ChatStream 订阅 `chat:part`,按 part.type 累积到 `message.parts[]`,React 按 parts 渲染。

**向后兼容**:`chat:token` 事件保留一个版本,内部转成 `{type:'text'}` part。两个版本后删除。

---

## 9. assistant-ui 适配策略(技术硬骨头 #2)

### 9.1 风险

- assistant-ui 默认走 Tailwind v4 配置,你用 v3 → 需手动桥接样式
- CJS/ESM:assistant-ui 是渲染进程依赖(ESM),不影响主进程 CJS
- peer deps 可能引入 native 模块 → 需核查

### 9.2 验证策略(M0 前置)

**M0 spike(0.5 天)**:在独立分支跑一个最小 demo:
1. `npm install @assistant-ui/react @assistant-ui/react-ai-sdk`
2. 用 assistant-ui 的 `Thread` 原语替换现有 ChatStream 的消息列表
3. 接 `useChat`(走你现有 IPC transport)
4. 验证:`npx vite build` 能过、`npm run dev:electron` 能渲染、Tailwind v3 样式正常

**如果 spike 失败**:fallback 到混合方案——不用 assistant-ui,纯 AI SDK v5 `message.parts` 自研渲染。失去 BranchPicker,但 M1-M3 仍可交付。

### 9.3 倾向:先用 AI SDK parts 自研,M0 spike 验证后再决定是否引入 assistant-ui

理由:你的产品 register 是 "earned trust not surprise",引入大依赖前先验证。AI SDK v5 parts 渲染已经能覆盖 80% 需求,BranchPicker 可以 M3 再评估。

---

## 10. Milestone 实施蓝图

### M0:技术验证 spike(0.5-1 天)
- [ ] assistant-ui + AI SDK parts + Tailwind v3 最小 demo
- [ ] 流式协议升级(agent-engine 推 `chat:part`)
- [ ] 决策:assistant-ui 进 or 自研 parts
- **验证**:`vite build` + `self-test` 通过;一个 thinking part 能在对话流渲染

### M1:三栏布局 + 流式协议(2-3 天)
- [ ] NavRail + PathOverview(左栏)
- [ ] ChatStream + ChatComposer(中栏,parts-based)
- [ ] ArtifactPanel(右栏,默认内容标签)
- [ ] Header 简化(设置移齿轮)
- [ ] ReasoningPart 折叠卡
- [ ] 移除 bubble-pulse / flame-flicker 动效
- **验证**:`ui-test` 16 DOM 断言更新通过;现有功能(对话/练习/导入)不回归

### M2:Generative UI + 答题嵌入(2-3 天)
- [ ] 新增 5 个展示型 tool(agent-engine + zod schema)
- [ ] ConceptMapArtifact / QuizArtifact / CompareTableArtifact / MermaidArtifact / CodeWalkthroughArtifact
- [ ] ExplainCard(答题后自动 AI 解释)
- [ ] Cmd+K 命令面板
- **验证**:`live-test-exercise` 覆盖 QuizArtifact;一个 tool 能在右栏渲染产物

### M3:路径线性化 + 复习面板(2-3 天)
- [ ] 技能树从 zig-zag → 线性单路径
- [ ] SM-2 复习节点交错插入路径
- [ ] ReviewPanel 四象限 + 队列封顶
- [ ] 自评双层反馈(客观题系统判 + 开放式三档自评)
- **验证**:复习节点在路径上可见;overdue 在导航栏红点;`verify-srs` 通过

### M4:打磨 + 颜色语义严格化(1-2 天)
- [ ] 全局颜色审计(绿/蓝/金/橙红 专属用途)
- [ ] 对比度验证(≥4.5:1 body)
- [ ] 所有组件状态词汇完整(default/hover/focus/active/disabled/loading/error)
- [ ] `prefers-reduced-motion` 全覆盖
- **验证**:`critique` + `audit` 命令跑过;p0/p1 清零

**总工期**:8-12 天(可并行压缩)。每个 milestone 独立可验证、可回滚。

---

## 11. 风险与验证策略

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| assistant-ui Tailwind v3 适配失败 | 中 | 中 | M0 spike 前置;fallback 自研 parts |
| 流式协议升级破坏现有对话 | 中 | 高 | `chat:token` 保留兼容期;`self-test` + `ui-test` 每步验证 |
| Generative UI tool 滥用(AI 乱调) | 中 | 中 | zod schema 严格校验;maxSteps 限制(现有 6);展示型 tool 只读不改状态 |
| 三栏在小屏拥挤 | 低 | 中 | 产物面板可折叠到 0;左栏 min 200px;断点 <1024px 折叠左栏 |
| 颜色语义严格化误删现有 UI | 低 | 低 | M4 单独审计,逐组件核对 |
| 线性路径重写破坏现有技能树测试 | 中 | 中 | `ui-test` 更新 DOM 断言;保留 LessonBubble 4 态逻辑只改布局 |

**验证三元组**(AGENTS.md 标准):每个 milestone 结束跑
```bash
npm run verify:core && npx vite build && npm run self-test
```
UI 改动额外跑 `npm run ui-test` + `npx tsx scripts/live-test/live-test-*.mjs`(需 key)。

---

## 12. 不做什么(明确边界)

- ❌ 不改 schema(14 表结构不变;新 tool 用现有 proposal/progress 机制)
- ❌ 不改 IPC 协议名(新增 `chat:part`,不删现有;channel 命名 `domain:action` 不变)
- ❌ 不引入新 runtime 依赖(除 assistant-ui,且 M0 验证后才定)
- ❌ 不做 gems/排行榜/虚拟货币(streak creep dark pattern)
- ❌ 不做装饰性编排动画(product register 禁)
- ❌ 不做移动端适配(桌面应用,<1024px 折叠即可)
- ❌ 不改 LLM provider 逻辑(BYOK 哲学不变,见 [[byok-custom-provider-philosophy]])

---

## 13. 成功标准

升级完成后,用户应该能感受到:
1. **AI 不再是"旁边的 chat"**——答题后自动有解释、Cmd+K 随时调起、产物在右栏可见。
2. **AI 的产出是"东西"不是"文字"**——概念图、对比表、练习卡是可看可存可复习的产物。
3. **复习是"前进"不是"倒退"**——复习节点在路径上,overdue 有红点,四象限清晰。
4. **界面更安静**——没有无限脉冲动画,颜色有秩序,思考过程可折叠。
5. **依然像 LookatStudy**——绿 #58cc02、3D 按钮、dark-first、earned trust 都在。Familiarity preserved.

---

*本文档为 impeccable 设计规划产物。实施时按 M0→M4 顺序,每 milestone 验证后再进下一个。*
