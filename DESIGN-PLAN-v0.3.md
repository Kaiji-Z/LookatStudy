# LookatStudy v0.3 — 趣味化重设计(黑板笔记本 + 选关地图)

> 这是 v0.2 的纠偏。v0.2 把产品做成了"工程师的工具",丢了多邻国的趣味性。
> v0.3 回归"寓教于乐"——轻松有趣的环境勾起学习欲望。
>
> 用户原话:"应该是一个轻松有趣的环境更能让人学的进去,寓教于乐嘛。"

---

## 0. 灵魂纠偏(一句话)

> **v0.2 是三个面板;v0.3 是一张地图、一位伙伴、一本笔记本。**
>
> 左栏是**游戏选关地图**(成就感的来源),
> 中栏是**和伙伴聊天的地方**(互动的乐趣),
> 右栏是**你的学习笔记本**(积累的厚度)。

---

## 1. 用户决策(锁定)

| 维度 | 决策 |
|---|---|
| 左栏 | 多邻国式**迷你地图**,合并仪表盘+技能树,信息密度集中,**可折叠** |
| 中栏 | Agent 互动区 + **字号调节**(A- A+) |
| 右栏 | **持久化黑板笔记本**(canvas_items 表,所有 AI 产物自动存,用户可删,可翻阅) |
| 虚拟老师 | 暂不做(留接口位) |
| 趣味性 | 按**最高要求预留**(粒子/音效/角色 IP 后续专门设计) |
| 仪表盘/技能树独立页 | **取消**(信息并进左栏地图) |
| 地图节点 | **多邻国式大节点**(圆形 3D + 皇冠 + 星星 0-3 + 蜿蜒路径) |
| 产物持久化 | **新建 canvas_items 表**,所有产物自动存,用户可单删(不让用户决定哪些存) |

---

## 2. 三栏架构(v0.3)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Header  Logo · 课程名       XP条 · 🔥连击 · ⚙️ · 主题                │
├──────────────┬──────────────────────────┬───────────────────────────┤
│              │                          │                           │
│  🗺️ 选关地图 │   💬 Agent 互动区         │   📓 黑板笔记本            │
│  (左,可折叠) │   (中)                   │   (右,持久)              │
│              │                          │                           │
│ 蜿蜒路径     │  对话流(parts)          │  当前节点内容             │
│ ●━━○━━◉     │  + 工具/proposal 卡      │  + AI 产物堆叠            │
│ 大圆球节点   │  + starter 横条          │  + 历史产物翻阅(按节点)  │
│ 星星/皇冠    │  + 输入框 [A-][A+]        │                           │
│ 锁/进行中    │  + Cmd+K 命令面板        │  📌 自动持久化            │
│              │                          │  🗑️ 可单删                │
│ 顶部:总进度  │                          │                           │
│ (合并仪表盘) │                          │                           │
│              │                          │                           │
│ [‹ 折叠]     │                          │                           │
└──────────────┴──────────────────────────┴───────────────────────────┘
```

### 2.1 左栏:选关地图(MapRail)

**核心隐喻**:游戏选关界面。打开应用第一眼就该看到"我在哪、下一步去哪、已拿了多少星"。

**信息架构**(自上而下):
1. **课程总进度条**(替代仪表盘的 overallMastery):一行带星星的总进度,如 `★★★☆☆ 45% · 7天连击`
2. **蜿蜒路径 + 大节点**:垂直蜿蜒(svg path),每个节点是 56px 圆球
3. **底部**:今日待复习数(🟠 徽章)+ 折叠按钮

**节点视觉(多邻国式)**:
- 🔒 灰锁圆球 = 未解锁
- 🟢 绿色 3D 圆球 + 脉冲 = 可学(active 节点)
- 🔵 蓝色 3D 圆球 = 进行中
- 🟡 金色 3D 圆球 + 👑 = 已掌握
- 节点下方:`★☆☆`(0-3 星进度)+ 节点名
- 路径连接:虚线(未解锁)/ 实线(已通)

**折叠态**:左栏缩成 48px 窄条,只显示 🗺️ 图标 + 当前节点小圆球,点击展开。

**为什么合并仪表盘**:仪表盘的核心信息(总掌握度、连击、待复习)在地图顶部一行就能表达,不必独立页。详细的"按章节掌握度热力图"可以作为地图节点的 tooltip/hover 卡片显示。

### 2.2 中栏:Agent 互动区(ChatWorkspace)

**核心**:这是用户和 AI 伙伴"聊天"的地方。轻松、有趣、可调字号。

**新增**:
- **字号调节** `A-` `A⁺`(输入框右侧):三档(小/中/大),localStorage 持久化,影响对话流 + 产物文字
- 保留 v0.2 的:parts 渲染、Cmd+K、starter、模式选择、停止/重发

**打磨方向**(后端结合项目):
- AI 回复更结构化(v0.2 已做 Markdown 排版,继续优化)
- 工具调用更透明(thinking trace 折叠)
- 答题反馈更生动(v0.3 预留粒子动画接口)

### 2.3 右栏:黑板笔记本(NotebookPanel)

**核心隐喻**:教室黑板 + 学习笔记本。AI 产物是"老师在黑板上写的内容",自动留存,可翻阅。

**三标签**(重新定义):
1. **讲解**(默认):当前节点的 markdown 内容
2. **笔记**:该节点的所有 AI 产物(概念图/对比表/练习/代码讲解/流程图),按时间倒序堆叠,**自动持久化**,每张可 🗑️ 删
3. **全部**:跨节点的笔记本视图(按时间/类型筛选),像翻一本完整笔记本

**产物卡生命周期**:
```
AI 生成 → 自动写入 canvas_items(绑定 nodeId)→ 显示在"笔记"标签
       → 用户可 📌 置顶 / 🗑️ 删除 / 点击放大查看
```

**翻阅体验**:
- 切节点 → "笔记"标签自动过滤到该节点的产物
- "全部"标签 → 时间线视图,像翻历史日志
- 搜索框(后续加):按关键词搜历史产物

---

## 3. 数据模型:canvas_items 表

```sql
CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,           -- 关联的课时(可空表示课程级)
  course_id TEXT NOT NULL,         -- 关联课程
  artifact_type TEXT NOT NULL,     -- concept_map / quiz / compare_table / diagram / code_walkthrough
  title TEXT,                      -- 产物标题
  data TEXT NOT NULL,              -- JSON 序列化的产物数据(与 tool execute 返回一致)
  pinned INTEGER DEFAULT 0,        -- 用户置顶
  created_at TEXT NOT NULL,        -- 创建时间
  notes TEXT                       -- 用户备注(后续)
);
CREATE INDEX IF NOT EXISTS idx_canvas_node ON canvas_items(node_id);
CREATE INDEX IF NOT EXISTS idx_canvas_course ON canvas_items(course_id);
CREATE INDEX IF NOT EXISTS idx_canvas_created ON canvas_items(created_at);
```

**IPC**:
- `canvas:list(nodeId?, courseId?)` — 列产物(可按节点过滤)
- `canvas:save(item)` — 保存产物(AI 生成时自动调)
- `canvas:delete(id)` — 用户删
- `canvas:togglePin(id)` — 置顶/取消

---

## 4. 趣味性预留(v0.3 不全做,留接口)

按用户要求"按最高要求预留",v0.3 实现**钩子**,后续专门设计填内容:

| 元素 | v0.3 | 未来 |
|---|---|---|
| 粒子动画(答对星星飞溅) | 预留 `<ParticleFx trigger="correct">` 组件占位 | Canvas/CSS 粒子 |
| 音效 | 预留 `playSfx("correct"|"unlock"|"streak")` 函数桩 | 本地音频文件 + 静音开关 |
| 虚拟老师 | NotebookPanel 留 `teacherSlot` prop | SVG/Lottie 角色 |
| 节点呼吸 | active 节点恢复克制脉冲(150-250ms) | 角色站在节点上 |
| 连击火焰 | 静态 🔥 + 数字(不闪烁) | 火焰动画 |

---

## 5. Milestone(v0.3)

### M0:数据层 + IPC(0.5 天)
- canvas_items 表 + schema.ts + drizzle 定义
- canvas:list/save/delete/togglePin IPC + preload + types
- verify 脚本

### M1:MapRail 选关地图(1.5 天)
- 多邻国式大节点组件(56px 3D 圆球 + 星星 + 皇冠 + 锁)
- 蜿蜒 svg 路径连接
- 顶部总进度条(合并仪表盘核心信息)
- 折叠态(48px 窄条)
- 取消仪表盘/技能树独立视图(导入保留)

### M2:NotebookPanel 黑板笔记本(1.5 天)
- 三标签:讲解 / 笔记 / 全部
- AI 产物自动持久化(tool execute 后调 canvas:save)
- 笔记列表(按节点过滤)+ 单删 + 置顶
- 全部视图(时间线)

### M3:字号调节 + agent 打磨(0.5 天)
- 中栏 A-/A+ 字号控制(localStorage + CSS var)
- agent prompt 继续优化结构化输出

### M4:趣味性钩子 + 验证(0.5 天)
- ParticleFx / playSfx 占位组件
- active 节点克制脉冲回归
- 颜色/对比度审计
- 全程 verify:core + vite build + ui-test + self-test

**总工期**:4-5 天。

---

## 6. 不做什么

- ❌ 不做虚拟老师形象(v0.3 留接口)
- ❌ 不做粒子/音效的完整实现(v0.3 只占位)
- ❌ 不做角色 IP(后续专门设计)
- ❌ 不让用户决定哪些产物存(全部自动存,用户只能删)
- ❌ 不保留仪表盘/技能树独立页(并进地图)

---

## 7. 与 v0.2 的关系

v0.2 的**技术基础保留**:
- ✅ 流式 parts 协议(chat:part)
- ✅ Generative UI tool 集(5 个展示型 tool)
- ✅ ChatStream/ChatComposer/CommandPalette 组件
- ✅ Artifact 渲染组件(ConceptMap/Quiz/CompareTable/Mermaid/CodeWalkthrough)
- ✅ useChatStream hook(含 StrictMode 修复)
- ✅ srs:getAll + ReviewPanel(复习体验保留,只是入口并进地图)

v0.2 需要**重构**的:
- 🔄 NavRail → MapRail(从列表变地图)
- 🔄 ArtifactPanel → NotebookPanel(从临时标签变持久笔记本)
- 🔄 App.tsx 视图切换(取消仪表盘/技能树独立页)
