/**
 * Starter Prompts 服务 —— "用户现在需要什么"的 4 个巩固选择。
 *
 * 设计转向(2026-08-13,动机层重构):
 *   旧版是"进节点就给一排静态 chips"(讲讲/关键点/为什么/考考我),在用户还没进入语境前
 *   就逼他做无谓决策 = 决策税。且和 hook 揭晓刚做的事重叠、含义模糊、hint 只靠 hover。
 *
 *   新版:这 4 个是**用户已经进到课的语境后(对话已开始)该做的"巩固动作"**,对应学习科学
 *   验证过的 4 条正交路径(一瞥→懂):精加工 / 具体化 / 检索 / 困惑处置。渲染层只在对话开始后
 *   才显示它们(语境前零决策税),并显示可见 hint(不靠 hover)。
 *
 *   "我没太懂"是原 ? 卡点表单的归宿:点它 → 发消息(AI 会追问"哪部分?")+ 记一条 friction。
 *   不再有 糊涂/卡住/受挫 三选下拉(在认知负荷最高处做元数据归类是反习惯的)。
 *
 * 不再按 mastery 分档:这 4 个是"一瞥→懂"的通用巩固集,适用任何刚揭晓的时刻。
 */
import { eq } from "drizzle-orm";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../db/schema.js";
import { contentNodes } from "../db/schema.js";
import type { StarterPrompt } from "@shared/types";

type Db = SQLJsDatabase<typeof schema>;

/**
 * 生成 4 个巩固选择(深入 / 举个例子 / 考考我 / 我没太懂)。
 *
 * 这是 hook 揭晓后、用户已进入语境时的"下一步"affordance。
 * 调用方(App)负责只在对话开始后才渲染它们。
 */
export function getStarterPrompts(db: Db, nodeId: string): StarterPrompt[] {
  const node = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.id, nodeId))
    .get();

  if (!node) return [];
  const title = node.title;

  return [
    {
      key: "go-deeper",
      icon: "🔬",
      label: "深入这点",
      message: `帮我深入讲讲「${title}」刚才那个核心点——展开它的结构、细节和容易忽略的边界。`,
      hint: "把刚揭晓的概念讲深一层",
    },
    {
      key: "give-example",
      icon: "💡",
      label: "举个例子",
      message: `给我一个「${title}」的实际例子或用法,让我更具体地理解。`,
      hint: "用真实例子帮你看懂",
    },
    {
      key: "quiz-me",
      icon: "📝",
      label: "考考我",
      message: `出一道关于「${title}」的应用题考考我,看我是否真懂了——我答完请判断对错。`,
      hint: "出题检验(答对涨掌握度)",
      advancesMastery: true,
    },
    {
      key: "confused",
      icon: "🤔",
      label: "我没太懂",
      message: `关于「${title}」,我有地方不太懂,帮我理一理——先问我是哪里不清楚。`,
      hint: "告诉 AI 你卡在哪(会记下)",
      frictionCategory: "confused",
    },
  ];
}
