/**
 * history-budget —— 对话历史 token 预算裁剪(纯函数)。
 *
 * 为什么(2026-08-31 评价定位的弱点):装配层每轮全量注入对话历史,
 * 长对话成本与窗口压力线性增长,最终撞上下文上限直接 400。裁剪策略:
 * **从最新往回累计**,超预算即停——最近的对话信息密度最高,最旧的先丢。
 *
 * 契约:
 *  - 输入序 = 装配序(旧→新);输出 kept 保持同序;
 *  - minKeep 硬保底:无论预算多小(含 <=0),至少保留最近 minKeep 条——
 *    当前问题与最近一轮回答永不被裁(宁溢出,不裁光);
 *  - 累计**严格大于**预算才丢(恰好压线保留);
 *  - 纯函数:不改入参数组,元素返回原引用(浅拷)。
 *
 * costOf 由调用方注入(每条消息的 token 成本;主进程装配传
 * (m)=>estimateTokens(m.content) 挂 shared/token-estimate 的 CJK 感知估算器)。
 * 吃消息而非裸文本:cost 语义留给调用方(图片消息可另计 vision 成本)。
 */
export interface TrimmedHistory<T> {
  kept: T[];
  droppedCount: number;
}

export function trimHistoryToBudget<T extends { role: string; content: string }>(
  messages: T[],
  budgetTokens: number,
  costOf: (m: T) => number,
  minKeep = 2,
): TrimmedHistory<T> {
  // 从尾往头累计,找到不超预算的最长后缀;含第 i 条后严格大于预算 → 第 i 条也丢。
  // cut 语义 = 丢弃 [0, cut)、保留 [cut, n);全保留 cut=0。
  // trimmed 标志:保底只在真发生裁剪时生效(全保留时 length-0 < minKeep 恒真,
  // 不加标志会把全保留误裁到 minKeep 条——T1/T8 事故)
  let acc = 0;
  let cut = 0;
  let trimmed = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const next = acc + costOf(messages[i]);
    if (next > budgetTokens) {
      cut = i + 1;
      trimmed = true;
      break;
    }
    acc = next;
  }
  // minKeep 硬保底:裁剪发生过且保留条数不足时拉回最近 minKeep 条
  // (预算极小/负数时保底生效;宁溢出,不裁光)
  if (trimmed && messages.length - cut < minKeep) {
    cut = Math.max(0, messages.length - minKeep);
  }
  return {
    kept: messages.slice(cut),
    droppedCount: cut,
  };
}
