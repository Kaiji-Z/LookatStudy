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
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS content_nodes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  parent_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('section', 'lesson', 'concept')),
  title TEXT NOT NULL,
  source_path TEXT,
  order_idx INTEGER NOT NULL DEFAULT 0,
  content TEXT
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
  mastery REAL
);

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
  active_skill TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- ============================================================
-- Skill 系统（v2 新增）
-- ============================================================

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('learning-mode', 'subject-pack', 'user-custom')),
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

