-- LookatStudy SQLite Schema
-- 单一来源（single source of truth）
--
-- 这个文件是 schema 的唯一真相。其他两处派生自此：
-- - schema.ts (drizzle 定义)：手写，但必须与此文件保持一致，由 verify-db 验证
-- - db/index.ts 的 runMigrations()：运行时读取本文件内容执行，不内嵌 SQL 字符串
--
-- 修改流程：改这个文件 → 跑 npm run verify:db 确认 schema.ts 一致 → 启动时自动 migrate

-- ============================================================
-- 课程与内容
-- ============================================================

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  repo_url TEXT,
  repo_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  lab_type TEXT NOT NULL DEFAULT 'doc' CHECK (lab_type IN ('doc', 'code', 'notebook')),
  -- 仓库原文语言 (BCP-47 子集: en / zh-CN / zh-TW / ja / ...), LLM 在 Step 2 判断
  source_lang TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS content_nodes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  parent_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('section', 'lesson', 'concept', 'exam')),
  title TEXT NOT NULL,
  source_path TEXT,
  order_idx INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  summary TEXT,
  world TEXT NOT NULL DEFAULT 'study' CHECK (world IN ('study', 'practice')),
  knowledge_points TEXT  -- JSON array of {title, description}，LLM 提取的知识组件定义
);
CREATE INDEX IF NOT EXISTS idx_content_nodes_course ON content_nodes(course_id);
CREATE INDEX IF NOT EXISTS idx_content_nodes_parent ON content_nodes(parent_id);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mcq', 'fill_blank', 'true_false', 'predict_output', 'order_lines', 'debug')),
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  explanation TEXT,
  options_json TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_exercises_node ON exercises(node_id);

-- ============================================================
-- 学习进度与间隔重复
-- ============================================================

CREATE TABLE IF NOT EXISTS progress (
  node_id TEXT PRIMARY KEY REFERENCES content_nodes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'locked' CHECK (status IN ('locked', 'available', 'in_progress', 'mastered')),
  crown_level INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  -- M2: BKT 掌握度概率 0-1（NULL=从未评估过，按未知处理）。存 REAL 避免整数缩放。
  -- Per-KC BKT: 有 knowledge_points 时此值 = min(各 KC mastery)（聚合值，只读）。
  mastery REAL
);

-- Per-Knowledge-Component BKT: 每个知识点独立的 BKT P(L)。课级 mastery = min(各 KC)。
CREATE TABLE IF NOT EXISTS knowledge_component_mastery (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
  kc_index INTEGER NOT NULL,         -- 对应 content_nodes.knowledge_points JSON 数组下标
  mastery REAL NOT NULL DEFAULT 0.5, -- per-KC BKT P(L)，初始 pInit
  tested_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(node_id, kc_index)
);
CREATE INDEX IF NOT EXISTS idx_kcm_node ON knowledge_component_mastery(node_id);

CREATE TABLE IF NOT EXISTS srs_items (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
  ease_factor INTEGER NOT NULL DEFAULT 250,
  interval_days INTEGER NOT NULL DEFAULT 0,
  repetitions INTEGER NOT NULL DEFAULT 0,
  due_at TEXT NOT NULL,
  last_reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_srs_due ON srs_items(due_at);

CREATE TABLE IF NOT EXISTS streaks (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date TEXT,
  freeze_count INTEGER NOT NULL DEFAULT 2
);
INSERT OR IGNORE INTO streaks (id) VALUES ('singleton');

-- ============================================================
-- AI 对话与 Agent
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES content_nodes(id) ON DELETE CASCADE,
  messages_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  active_soul TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- ============================================================
-- Soul 系统（教学人设/persona）
-- ============================================================

CREATE TABLE IF NOT EXISTS souls (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('builtin', 'custom')),
  body TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- ============================================================
-- Proposal 流水线（v2 新增）
-- ============================================================

CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES content_nodes(id) ON DELETE CASCADE,
  operations_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'stale')),
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  resolved_at TEXT
);

-- ============================================================
-- Friction 日志（v2 新增，Agent 静默记录学习者卡壳）
-- ============================================================

CREATE TABLE IF NOT EXISTS friction_log (
  id TEXT PRIMARY KEY,
  node_id TEXT,
  category TEXT NOT NULL CHECK (category IN ('confused', 'blocked', 'frustrated', 'agent_error')),
  summary TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- ============================================================
-- 设置（API keys 等敏感配置）
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- 轻量 RAG（M3）：v0.1 用 LIKE 兜底检索（ROADMAP R2 风险项已定）
-- ============================================================
-- sql.js 的 WASM 构建不含 FTS5 扩展模块，所以 v0.1 不建 FTS 虚拟表。
-- search-service.ts 用 content_nodes.content LIKE '%query%' 兜底。
-- v0.2 换含 FTS5 的 SQLite 构建后，再升级为 FTS5 + BM25。

-- ============================================================
-- 记忆系统（M3）：跨会话 SUMMARY 滚动摘要
-- ============================================================

CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  node_id TEXT,                      -- 关联的节点（可空，全局记忆）
  summary TEXT NOT NULL,             -- 滚动摘要正文
  category TEXT NOT NULL CHECK (category IN ('global', 'node', 'friction_pattern')),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_memory_node ON memory(node_id);
CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);

-- ============================================================
-- 自定义 Provider（用户自建 LLM 端点，覆盖预设无法穷举的场景）
-- 如：智谱 CodingPlan CN/Global、各 provider 区域端点、自建代理、Ollama 本地等
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_providers (
  id TEXT PRIMARY KEY,               -- 'custom-' + uuid，也作为 active_provider 的值
  label TEXT NOT NULL,               -- 用户起的名字，如 "智谱 CodingPlan CN"
  protocol TEXT NOT NULL DEFAULT 'openai-compatible'
    CHECK (protocol IN ('openai-compatible', 'anthropic', 'google')),
  base_url TEXT NOT NULL,            -- 如 https://api.z.ai/api/coding/paas/v4
  api_key TEXT,                      -- 可空（本地模型如 Ollama 不需要 key）
  default_model TEXT NOT NULL,       -- 默认模型 id
  models_json TEXT,                  -- 可选：模型列表 JSON（用户手填或测试连接回填）
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);


-- ============================================================
-- canvas_items: AI 产物画布(v0.3 黑板笔记本)
-- 所有 Generative UI 产物(概念图/对比表/练习/代码讲解/流程图)自动持久化,
-- 用户可单删/置顶,按节点或课程翻阅。这是"学习笔记本"的数据基础。
-- ============================================================

CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,               -- uuid
  node_id TEXT,                      -- 关联的课时(可空表示课程级产物)
  course_id TEXT NOT NULL,           -- 关联课程
  artifact_type TEXT NOT NULL,       -- concept_map / quiz / compare_table / diagram / code_walkthrough / user_note
  title TEXT,                        -- 产物标题
  data TEXT NOT NULL,                -- JSON 序列化的产物数据(与 tool execute 返回一致)
  pinned INTEGER DEFAULT 0,          -- 用户置顶(0/1)
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  notes TEXT,                        -- 用户备注(后续扩展)
  -- v0.3 康奈尔笔记法:溯源 + 练习记录
  source_type TEXT,                  -- 'ai'(产物默认) / 'content'(讲解画线) / 'chat'(对话画线)
  source_anchor TEXT,                -- 溯源锚点 JSON:content={surroundingText} / chat={threadId,msgId}
  last_result TEXT,                  -- 仅 quiz:最近一次答题 'correct'/'wrong'
  result_at TEXT                     -- 仅 quiz:答题时间
);

CREATE INDEX IF NOT EXISTS idx_canvas_node ON canvas_items(node_id);
CREATE INDEX IF NOT EXISTS idx_canvas_course ON canvas_items(course_id);
CREATE INDEX IF NOT EXISTS idx_canvas_created ON canvas_items(created_at);

-- ============================================================
-- threads + chat_messages: v0.4 会话 Thread 模型(类 Cursor 项目-会话)
-- 把"节点即会话"升级为"课程(项目)→ 多 thread(会话)→ 节点是素材"。
-- AI 上下文 = thread 的所有消息 + 焦点节点内容 + 课程级 memory。
-- 旧 chat_sessions 表保留不动(向后兼容,新代码不读写)。
-- ============================================================

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,               -- thread id (uuid)
  course_id TEXT NOT NULL,           -- 属于哪个课程(项目)
  title TEXT,                        -- 用户起的名,如"注意力机制深挖"
  focus_node_id TEXT,                -- 主焦点节点(可空,影响 AI 注入的节点上下文)
  status TEXT NOT NULL DEFAULT 'active',  -- active / archived
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_threads_course ON threads(course_id, status, updated_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,               -- uuid
  thread_id TEXT NOT NULL,           -- 关联 thread
  role TEXT NOT NULL,                -- user / assistant
  content TEXT NOT NULL,             -- 文本内容
  parts_json TEXT,                   -- v0.2 parts 产物/tool/reasoning(JSON,可空)
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON chat_messages(thread_id, created_at);

-- ============================================================
-- 多模态资源:导入课程时收集的图片 / PDF 页面渲染图
-- ============================================================
-- 图片二进制不入 DB(sql.js 内存型,塞图会爆),只存元数据。
-- 实际文件存 userData/assets/{courseId}/{filename}。
-- agent-engine 在"用户问图相关问题时"按需读取喂给多模态 LLM。

CREATE TABLE IF NOT EXISTS node_assets (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,                       -- assets 目录下的文件名(如 lesson1-fig01.png)
  mime_type TEXT NOT NULL,                      -- image/png / image/jpeg / image/svg+xml 等
  source_path TEXT,                             -- 源文件里的原始相对路径(如 lessons/1/img.png)
  source_kind TEXT NOT NULL CHECK (source_kind IN ('image_file', 'markdown_ref', 'pdf_page')),
  width INTEGER,                                -- 像素宽(可空,svg/pdf 无)
  height INTEGER,                               -- 像素高(可空)
  page_number INTEGER,                          -- PDF 来源页码(可空,1-based)
  alt_text TEXT,                                -- ![](x) 的 alt 或文件名推断描述
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
CREATE INDEX IF NOT EXISTS idx_node_assets_node ON node_assets(node_id);
CREATE INDEX IF NOT EXISTS idx_node_assets_course ON node_assets(course_id);

-- ============================================================
-- 内容翻译（多语言课程）：每个节点的每种语言一个翻译行
-- 进度/掌握度在 progress 表（共享），切语言不重置进度。
-- ============================================================

CREATE TABLE IF NOT EXISTS content_node_translations (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES content_nodes(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,              -- "zh-CN", "ja", "fr" 等 BCP-47 标签
  title TEXT NOT NULL,               -- 翻译版标题
  content TEXT,                      -- 翻译版正文（markdown）
  summary TEXT,                      -- 翻译版摘要
  UNIQUE(node_id, locale)            -- 每节点每语言一行
);
CREATE INDEX IF NOT EXISTS idx_translations_node ON content_node_translations(node_id);
CREATE INDEX IF NOT EXISTS idx_translations_course_locale ON content_node_translations(course_id, locale);
