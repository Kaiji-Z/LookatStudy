# LookatStudy v0.4 — 会话 Thread 模型(类 Cursor 项目-会话)

> v0.3 之上增量。把"节点即会话"升级为"课程(项目)→ 多 thread(会话)→ 节点是素材"。
> AI 有跨会话的项目级记忆(memory 表)。

## 决策(锁定)
- 不迁移旧 chat_sessions 数据,重新开始
- 节点与 thread 多对多(thread 记 focus_node_id,不独占节点)
- AI 上下文 = thread 的所有消息 + 焦点节点内容 + 课程级 memory

## 数据模型

```sql
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT,
  focus_node_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',   -- active / archived
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_threads_course ON threads(course_id, status, updated_at);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL,                      -- user / assistant
  content TEXT NOT NULL,
  parts_json TEXT,                         -- v0.2 parts 产物/tool/reasoning
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX idx_messages_thread ON chat_messages(thread_id, created_at);
```

旧 `chat_sessions` 表保留不动(向后兼容,新代码不读写它)。

## IPC
- `thread:list(courseId, status?)` → Thread[]
- `thread:create(courseId, focusNodeId?, title?)` → Thread
- `thread:update(id, { title?, status?, focusNodeId? })` → Thread
- `thread:delete(id)` → 硬删(连带消息)
- `thread:getMessages(threadId)` → ChatMessage[]
- `thread:sendMessage(threadId, text)` → 流式(复用现有 chat:part 协议)

## UI 变化
- 中栏顶部加 thread 切换条:`📍 焦点节点 ▾ [当前 thread 标题]`
- 点 ▾ 弹 thread 列表(按 updated_at 倒序):当前课程所有 active thread + 归档入口 + 新建按钮
- thread 列表项:标题 + 消息数 + 最后更新时间 + 右键菜单(重命名/归档/删除)
- 焦点节点切换:thread 内可换焦点(影响 AI 注入的节点上下文)

## AI 上下文装配(agent-engine 改造)
```
system prompt = BASE + 课程大纲(已有)
+ 焦点节点内容(从 thread.focusNodeId 取)
+ memory 关键点(跨 thread,已有 memory 表)
messages = thread 的所有 chat_messages(role+content)
```

memory 用法不变,但现在天然跨 thread 服务"AI 记得你之前问过的关键点"。

## 点节点的行为(节点-thread 多对多)
- 点地图节点 → 检查是否有 focus_node_id = 该节点的 active thread
  - 有 → 打开最近更新的那条
  - 无 → 提示"新建会话"或"切换到其他 thread"
- thread 内随时可换焦点节点(顶部 📍 点击切换)
- 一个节点可被多个 thread 引用(理论探讨/实操/复习各一条)

## Milestone
- M0:数据层(threads + chat_messages 表 + schema + IPC + verify)
- M1:thread service + agent-engine 改造(传 threadId 装配上下文)
- M2:UI:中栏 thread 切换条 + 列表弹层 + 新建/归档/删除
- M3:焦点节点切换 + memory 跨 thread 注入打磨
- M4:全程验证 + ui-test 更新
