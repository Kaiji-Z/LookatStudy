/**
 * 学习 tips 库(未选课态右栏的兜底卡, SPEC §3)—— 双语,按日确定性轮换。
 *
 * 定位:新用户无学习数据时的右栏轻内容(有数据时显示「学习回顾」主卡);
 * 只给一点点温度,右栏是配角(克制原则),条目要短。
 */
export interface BootTip {
  id: string;
  zh: string;
  en: string;
}

export const BOOT_TIPS: BootTip[] = [
  { id: "spacing", zh: "隔一天再复习,比当场连看三遍记得牢——间隔重复是记忆的免费午餐。", en: "Revisiting after a day beats three passes in a row — spacing is memory's free lunch." },
  { id: "recall", zh: "合上书回想一遍,比再读一遍有效得多。难受的感觉正是记忆在加固。", en: "Close the book and recall — far more effective than rereading. The strain IS the strengthening." },
  { id: "teach", zh: "学完就假装教一个外行:讲不清的地方,就是你没真懂的地方。", en: "After learning, teach it to a layman: where you can't explain clearly is where you don't understand." },
  { id: "interleave", zh: "交替练不同的题型,比同一题型连刷十道更接近真实考试的样子。", en: "Mixing problem types beats grinding ten of the same — it looks more like real tests." },
  { id: "sleep", zh: "睡眠是记忆的保存按钮——熬夜学的,大脑来不及归档。", en: "Sleep is memory's save button — the brain can't file what you crammed at 3am." },
  { id: "small", zh: "每天 20 分钟胜过每周末 3 小时:习惯的对手是中断,不是时长。", en: "Twenty minutes daily beats three hours on Sunday: habits die from breaks, not from shortness." },
  { id: "why", zh: "先问「这东西解决什么问题」再学怎么做——带着问题的脑子记得牢。", en: "Ask 'what problem does this solve' before 'how' — a question-loaded brain retains better." },
  { id: "mistakes", zh: "错题本不是抄题本:只记「我当时为什么会那么想」。", en: "A mistake log isn't for copying problems — record only 'why did I think that'." },
  { id: "analogy", zh: "新概念配一个你熟悉领域的类比,像给记忆一个挂钩。", en: "Pair every new concept with an analogy from familiar ground — give memory a hook." },
  { id: "env", zh: "固定的学习角落会形成条件反射:一坐下,大脑就知道该开工了。", en: "A fixed study spot builds a reflex: sit down, and the brain knows it's time." },
];

/** 按日期确定性轮换(FNV-1a,与 boot-quiz 同法)。 */
export function pickBootTip(dateISODate: string, locale: string): { id: string; text: string } {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateISODate.length; i++) {
    h ^= dateISODate.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const item = BOOT_TIPS[Math.abs(h) % BOOT_TIPS.length];
  return { id: item.id, text: locale === "en" ? item.en : item.zh };
}
