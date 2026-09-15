/**
 * 试玩题库（boot 向导第三步"来，过一招"）—— 通用趣味二选一，双语（SPEC §2.2）。
 *
 * 纪律：
 *   - 单独维护，不从种子课程出（要的是"好玩"不是"教知识"）；
 *   - 不计分、不写库，答完 celebrate 纯庆祝 —— 让用户第一次体验"被当作具体的人来教"；
 *   - 按日期确定性轮换（seed=YYYY-MM-DD），同一天所有用户/刷新看到同一题。
 */

export interface BootQuizItem {
  id: string;
  /** 更站得住脚的一侧(reveal 的褒义方向)——庆祝粒子只在该侧触发,防"差一点!"配 correct 庆祝的动效矛盾 */
  better: "a" | "b";
  zh: { q: string; a: string; b: string; revealA: string; revealB: string };
  en: { q: string; a: string; b: string; revealA: string; revealB: string };
}

export const BOOT_QUIZ_BANK: BootQuizItem[] = [
  {
    id: "cable-vs-wifi",
    better: "a",
    zh: {
      q: "同样一段数据，走网线还是走 WiFi，哪个延迟更低？",
      a: "网线",
      b: "WiFi",
      revealA: "对！网线是全双工专用通道，不受空气里的排队和干扰——打游戏的都懂。",
      revealB: "差一点！WiFi 是共享无线信道，要排队抢空气；网线是专用通道，延迟更稳更低。",
    },
    en: {
      q: "For the same chunk of data, which has lower latency — Ethernet cable or WiFi?",
      a: "Ethernet cable",
      b: "WiFi",
      revealA: "Correct! Ethernet is a dedicated full-duplex lane — no queuing in the air. Gamers know.",
      revealB: "Close! WiFi shares the wireless medium and queues for airtime; Ethernet is a dedicated lane with lower, steadier latency.",
    },
  },
  {
    id: "http-vs-https",
    better: "a",
    zh: {
      q: "浏览器地址栏的 https 里的 s，保护的是哪一段？",
      a: "你电脑到网站之间的传输",
      b: "网站服务器本身不被黑",
      revealA: "对！s = 传输加密，防的是路上的偷看和篡改；服务器被黑是另一回事。",
      revealB: "不是哦——s 只加密'路上'的传输，服务器自己被攻破它管不着。",
    },
    en: {
      q: "In https, what does the 's' actually protect?",
      a: "The transport between your computer and the site",
      b: "The server from being hacked",
      revealA: "Right! s = encrypted transport — it stops eavesdropping and tampering in transit. Server breaches are a different problem.",
      revealB: "Not quite — the 's' only encrypts the road; if the server itself is compromised, it can't help.",
    },
  },
  {
    id: "ram-vs-disk",
    better: "b",
    zh: {
      q: "断电后数据还在的是？",
      a: "内存（RAM）",
      b: "硬盘",
      revealB: "对！硬盘是持久存储；内存断电即忘——所以'保存'保存的是写进硬盘。",
      revealA: "恰恰相反——内存断电就忘，硬盘才记得住。'保存'就是从内存写进硬盘。",
    },
    en: {
      q: "Which one keeps its data after a power cut?",
      a: "RAM",
      b: "The disk",
      revealB: "Correct! Disks persist; RAM forgets on power loss — that's why 'save' means writing to disk.",
      revealA: "Other way around — RAM forgets on power loss; disks remember. 'Saving' means writing from RAM to disk.",
    },
  },
  {
    id: "compile-vs-run",
    better: "b",
    zh: {
      q: "你写的代码，CPU 直接执行的是？",
      a: "你敲的源代码",
      b: "翻译后的机器指令",
      revealB: "对！CPU 只吃自己的指令集；你写的代码先被翻译（编译/解释）成机器指令。",
      revealA: "不不——CPU 看不懂你敲的语言，它只执行翻译后的机器指令。",
    },
    en: {
      q: "What does the CPU actually execute directly?",
      a: "The source code you type",
      b: "Translated machine instructions",
      revealB: "Correct! The CPU only speaks its own instruction set; your code is translated (compiled/interpreted) first.",
      revealA: "Nope — the CPU can't read your language; it runs translated machine instructions only.",
    },
  },
  {
    id: "shortcut-ctrl-z",
    better: "a",
    zh: {
      q: "Ctrl+Z 撤销的是？",
      a: "上一次操作",
      b: "上一次保存",
      revealA: "对！撤销栈记的是操作历史，一步一步可以回退——是个'时间倒流'按钮。",
      revealB: "不是保存——撤销回退的是操作历史，跟保存点无关。",
    },
    en: {
      q: "What does Ctrl+Z undo?",
      a: "Your last action",
      b: "Your last save",
      revealA: "Right! The undo stack records action history — it's a mini time machine.",
      revealB: "Not saves — undo steps back through actions, not save points.",
    },
  },
  {
    id: "cache-purpose",
    better: "a",
    zh: {
      q: "为什么删了缓存，下次打开 app 反而更慢？",
      a: "缓存是提前备好的常用数据",
      b: "删缓存把网络也删慢了",
      revealA: "对！缓存就是'放得近的备用件'，删了它，app 只好重新去老远的地方拉一遍。",
      revealB: "网络没变慢——是缓存没了，常用数据得重新下载/计算一遍。",
    },
    en: {
      q: "Why is an app slower right after you clear its cache?",
      a: "Cache holds pre-fetched frequently-used data",
      b: "Clearing cache slows down your network",
      revealA: "Right! Cache is 'spare parts kept nearby'; clear it and the app must fetch everything from far away again.",
      revealB: "Your network didn't change — the cache is gone, so common data must be re-downloaded and recomputed.",
    },
  },
];

/** 按日期确定性选题：同一天所有人同一题（seed=YYYY-MM-DD）。 */
export function pickBootQuiz(dateISODate: string, locale: string): { id: string; q: string; a: string; b: string; revealA: string; revealB: string; better: "a" | "b" } {
  const item = BOOT_QUIZ_BANK[quizIndexForDate(dateISODate, BOOT_QUIZ_BANK.length)];
  return locale === "en"
    ? { id: item.id, q: item.en.q, a: item.en.a, b: item.en.b, revealA: item.en.revealA, revealB: item.en.revealB, better: item.better }
    : { id: item.id, q: item.zh.q, a: item.zh.a, b: item.zh.b, revealA: item.zh.revealA, revealB: item.zh.revealB, better: item.better };
}

/** 日期字符串 → 稳定桶下标（FNV-1a，对任意字符串确定）。 */
export function quizIndexForDate(dateISODate: string, length: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateISODate.length; i++) {
    h ^= dateISODate.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % length;
}
