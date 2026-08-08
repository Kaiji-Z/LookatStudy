/**
 * Starter Prompts 服务 —— 给学习者提供"开始按钮"。
 *
 * 解决的痛点: 用户点进一个 lesson 后，面对空白输入框不知道该说什么。
 * 本服务基于课程内容 + 掌握度，生成 3-4 个上下文相关的引导提示词。
 *
 * 两种模式:
 *   - 确定性模式（不需要 LLM）: 基于节点状态 + 模板，快、免费、可离线
 *   - LLM 模式（需要 key）: 基于实际内容生成更精准的引导问题
 *
 * 渲染层把 starter prompts 显示为可点击按钮 → 点击直接填入输入框发送。
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { contentNodes, progress as progressTable } from "../db/schema.js";

type Db = SQLJsDatabase<typeof schema>;

export interface StarterPrompt {
  /** 按钮显示文字 */
  label: string;
  /** 点击后发送的完整消息 */
  message: string;
  /** 图标 emoji */
  icon: string;
  /** 标记:点这个按钮能涨掌握度(AI 会出题/判定 → record_answer proposal)。
   *  渲染时给这类按钮加视觉标记,让用户知道"点这个能涨进度"。 */
  advancesMastery?: boolean;
}

/**
 * 生成 starter prompts。
 *
 * 策略:
 *   - 新课（mastery null / 0）: "从零开始"导向 → 概览、核心概念、前置知识
 *   - 学习中（mastery 0.1-0.7）: "继续深入"导向 → 疑难、应用、辨析
 *   - 接近掌握（mastery >0.7）: "检验"导向 → 总结、关联、综合应用
 */
export function getStarterPrompts(db: Db, nodeId: string): StarterPrompt[] {
  const node = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.id, nodeId))
    .get();

  if (!node) return [];

  const progress = db
    .select()
    .from(progressTable)
    .where(eq(progressTable.nodeId, nodeId))
    .get();

  const mastery = progress?.mastery ?? null;

  // 根据掌握度分阶段
  if (mastery === null || mastery < 0.1) {
    // 新课
    return [
      {
        icon: "📖",
        label: "讲讲这一课",
        message: `请帮我理解「${node.title}」的核心概念，用简单的方式讲解。`,
      },
      {
        icon: "🔑",
        label: "关键知识点",
        message: `「${node.title}」有哪些必须掌握的关键知识点？`,
      },
      {
        icon: "💡",
        label: "为什么学这个",
        message: `为什么「${node.title}」很重要？在实际中有什么用？`,
      },
      {
        icon: "📝",
        label: "考考我",
        message: `出一道关于「${node.title}」的选择题考考我,我答完后请判断对错。`,
        advancesMastery: true,
      },
    ];
  }

  if (mastery < 0.7) {
    // 学习中
    return [
      {
        icon: "❓",
        label: "我有疑问",
        message: `关于「${node.title}」，我有些地方不太懂，能不能帮我深入讲解？`,
      },
      {
        icon: "🔄",
        label: "对比辨析",
        message: `「${node.title}」里的核心概念之间有什么区别和联系？`,
      },
      {
        icon: "📝",
        label: "考考我",
        message: `出一道关于「${node.title}」的选择题考考我,我答完后请判断对错。`,
        advancesMastery: true,
      },
      {
        icon: "🎯",
        label: "实际应用",
        message: `「${node.title}」的知识在实际项目中怎么用？举个例子。`,
      },
    ];
  }

  // 接近掌握
  return [
    {
      icon: "🏆",
      label: "总结回顾",
      message: `帮我总结「${node.title}」的核心要点，检验我是否真的掌握了。`,
    },
    {
      icon: "📝",
      label: "最终测验",
      message: `「${node.title}」我学得差不多了,出几道有难度的题检验我,根据我的回答判断是否掌握。`,
      advancesMastery: true,
    },
    {
      icon: "🔗",
      label: "知识关联",
      message: `「${node.title}」和课程其他内容有什么关联？在整个体系里起什么作用？`,
    },
    {
      icon: "🚀",
      label: "进阶挑战",
      message: `「${node.title}」我已经基本掌握了，有什么更进阶的挑战或拓展？`,
    },
  ];
}
