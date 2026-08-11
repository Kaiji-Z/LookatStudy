/**
 * Flag 默认值表 —— 纯数据，零依赖。
 *
 * 单独抽出是为了 verify-flags.mjs 能直接 import 真实源码测"默认全 off"不变量
 * （VERIFICATION §4: 默认 off = 改动前行为；任何把默认改 on 的提交都要被这个测试拦下）。
 *
 * 新增 flag 加到这里即可。每条都要默认 false 除非有明确理由（在注释里写）。
 */

export type FlagName =
  | "skill_system" // M1: Skill 系统 + 课程树 UI
  | "agent_engine" // M2: Agent 引擎 + Propose/Apply
  | "bkt_mastery" // M2: BKT 掌握度
  | "lightweight_rag" // M3: 轻量 RAG
  | "memory_system" // M3: 记忆系统
  | "image_download" // 导入时从 CDN 下载 md/ipynb 里引用的相对路径图片(不涉及 AI)
  | "multimodal_import"; // AI 多模态:vision 模型识图/看图(需要 API key + vision 模型)

export const FLAG_DEFAULTS: Record<FlagName, boolean> = {
  skill_system: false,
  agent_engine: false,
  bkt_mastery: false,
  lightweight_rag: false,
  memory_system: false,
  // 图片下载默认 on —— md 里有图片引用就应该导入,不需要 AI 识图
  image_download: true,
  multimodal_import: false,
};

/** 类型守卫：避免用字符串乱传 flag 名 */
export function isFlagName(name: string): name is FlagName {
  return Object.prototype.hasOwnProperty.call(FLAG_DEFAULTS, name);
}
