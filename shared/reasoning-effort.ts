/**
 * 思考强度映射(纯函数) —— "fast/deep" 偏好如何落到具体 provider 的请求参数。
 *
 * 现实:reasoning 控制没有跨厂商标准 —— GLM 走 body.thinking.type,Qwen 走
 * body.enable_thinking,OpenAI 走 reasoning_effort,Anthropic/Google 走各自的
 * providerOptions。本模块是这张"方言表"的单一真源:
 *   - UI 门控: supportsReasoningControl() 决定芯条是否可用
 *   - 引擎落地: reasoningPlanFor() 产出 none | providerOptions | bodyPatch 三种计划
 *
 * 原则:自动("")= 零干预;不支持的家族 = none(宁可不生效,不瞎发参数吃 400)。
 */
import type { ReasoningEffortSetting } from "./types";

/** 三协议 id(与 ProviderPreset.protocol / CustomProvider.protocol 一致)。 */
export type LlmProtocol = "openai-compatible" | "anthropic" | "google";

/** openai-compatible 里的"家族"(按 preset id 判定)→ 请求体注入键。
 * 不在表内 = 该家族没有(可靠的)思考开关,自动降级 none。 */
const BODY_PATCH_FAMILIES: Record<
  string,
  { fast: (b: Record<string, unknown>) => void; deep: (b: Record<string, unknown>) => void }
> = {
  // 智谱 GLM(含 CodingPlan 端点同款 API):thinking.type
  glm: {
    fast: (b) => {
      b.thinking = { type: "disabled" };
      // 思考与正文共享输出额度:默认强度会把预算全用来思考(实测 32K 池想了 6min+
      // 零正文;8K 池挤掉 JSON)——low 让思考短、正文放得下。两个都是官方参数,
      // 端点认哪个用哪个(CodingPlan 无视 disabled 但认 low)。
      b.reasoning_effort = "low";
    },
    deep: (b) => {
      b.thinking = { type: "enabled" };
    },
  },
  // 阿里 Qwen(DashScope 兼容模式):enable_thinking
  qwen: {
    fast: (b) => {
      b.enable_thinking = false;
    },
    deep: (b) => {
      b.enable_thinking = true;
    },
  },
  // SiliconCloud:托管 Qwen/GLM 等,同样认 enable_thinking(部分模型忽略,无害)
  siliconcloud: {
    fast: (b) => {
      b.enable_thinking = false;
    },
    deep: (b) => {
      b.enable_thinking = true;
    },
  },
};

/** OpenAI 官方(preset id "openai"):原生 reasoningEffort。 */
const OPENAI_EFFORT: Record<"fast" | "deep", "low" | "high"> = { fast: "low", deep: "high" };

/** 落地计划。providerOptions 交给 streamText 原生透传;bodyPatch 改写请求体 JSON。 */
export type ReasoningPlan =
  | { kind: "none" }
  | { kind: "providerOptions"; options: Record<string, Record<string, ReasoningJsonValue>> }
  | { kind: "bodyPatch"; patch: (body: Record<string, unknown>) => void };

/** 结构化 JSON 值(AI SDK providerOptions 的元素类型;shared 侧自持定义,不 import "ai")。 */
export type ReasoningJsonValue = string | number | boolean | null | ReasoningJsonValue[] | { [k: string]: ReasoningJsonValue };

/**
 * provider 家族判定:预设 id 直接命中;**自定义 provider(custom-\*)按 baseUrl/模型名嗅探**。
 * 用户主力是自定义 provider(智谱一家就有 4 个端点),预设 id 查表对它们永远落空
 * → 思考开关静默失效(实测:custom ZAI CodingPlan + glm-5.2,thinking 关不掉,
 * 结构设计 JSON 被 7k+ 思考 token 挤出 8192 上限,二分到 20 文件仍截断)。
 * 嗅探保守:认不出返回原 id(降级 none,宁可不生效不瞎发参数吃 400)。
 */
export function llmFamilyOf(providerId: string, baseUrl?: string, model?: string): string {
  if (providerId === "openai" || providerId in BODY_PATCH_FAMILIES) return providerId;
  const url = (baseUrl ?? "").toLowerCase();
  const m = (model ?? "").toLowerCase();
  // 智谱:bigmodel.cn / z.ai 端点(CodingPlan 同款 API),或 glm 前缀模型
  if (url.includes("bigmodel.cn") || url.includes("z.ai") || m.startsWith("glm")) return "glm";
  // 阿里:DashScope 端点或 qwen 前缀模型
  if (url.includes("dashscope") || m.startsWith("qwen")) return "qwen";
  // SiliconCloud 托管端点
  if (url.includes("siliconflow")) return "siliconcloud";
  return providerId;
}

/** 该 provider 是否支持思考强度控制(不支持的:芯片禁用 + tooltip 说明)。 */
export function supportsReasoningControl(providerId: string, protocol: LlmProtocol): boolean {
  if (protocol === "anthropic" || protocol === "google") return true;
  return providerId === "openai" || providerId in BODY_PATCH_FAMILIES;
}

/**
 * 产出落地计划。effort 为空(自动)或家族不支持 → none。
 * anthropic: fast=不传(默认关),deep=开 2048 预算(保守值,远小于各家默认 max_tokens,
 *   避免预算>上限的 400);google: fast=thinkingBudget 0(硬关),deep=-1(动态)。
 */
export function reasoningPlanFor(
  providerId: string,
  protocol: LlmProtocol,
  effort: ReasoningEffortSetting,
  hints?: { baseUrl?: string; model?: string },
): ReasoningPlan {
  if (!effort) return { kind: "none" };
  if (protocol === "anthropic") {
    if (effort === "fast") return { kind: "none" }; // Claude 默认不思考,fast=零干预
    return {
      kind: "providerOptions",
      options: { anthropic: { thinking: { type: "enabled", budgetTokens: 2048 } } },
    };
  }
  if (protocol === "google") {
    return {
      kind: "providerOptions",
      options: { google: { thinkingConfig: { thinkingBudget: effort === "fast" ? 0 : -1 } } },
    };
  }
  // openai-compatible:OpenAI 官方走原生 reasoningEffort;表内家族走请求体注入
  if (providerId === "openai") {
    return {
      kind: "providerOptions",
      options: { openai: { reasoningEffort: OPENAI_EFFORT[effort] } },
    };
  }
  const family = BODY_PATCH_FAMILIES[llmFamilyOf(providerId, hints?.baseUrl, hints?.model)];
  if (!family) return { kind: "none" };
  return { kind: "bodyPatch", patch: family[effort] };
}

/**
 * 给 fetch 包一层"请求体补丁":解析 JSON body → patch → 重写。
 * 解析失败/非字符串 body 原样放行(补丁是尽力而为,不是硬约束)。
 */
export function withBodyPatch(
  baseFetch: typeof fetch,
  patch: (body: Record<string, unknown>) => void,
): typeof fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string" && init.body.startsWith("{")) {
      try {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        patch(body);
        init = { ...init, body: JSON.stringify(body) };
      } catch {
        /* 非 JSON/畸形体:不动,照发 */
      }
    }
    return baseFetch(input, init);
  };
}
