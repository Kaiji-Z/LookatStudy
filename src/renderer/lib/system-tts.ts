/**
 * system-tts —— system 档(浏览器/系统 speechSynthesis)的纯函数层。
 *
 * 音色是设备抽签:国产安卓机的讯飞/厂商引擎常常好于 kokoro,Windows Chrome
 * 枚举的本地 SAPI 音色可能更机械——所以 system 只做**显式档**(用户自选),
 * 不进 edge→local 自动降级链。挑选策略:记住的名字优先,否则中文优先、
 * 标记 default 优先,保证确定性(verify 直测)。
 *
 * 播放管线在 useSpeech(逐句 utterance → playingSentence,karaoke/伴学共用);
 * 本文件不碰 window,便于纯函数测试。
 */

/** 设置页改语音设置时广播(所有 useSpeech 实例重拉档位缓存;单一真源) */
export const TTS_SETTINGS_CHANGED_EVENT = "lookatstudy-tts-settings-changed";

export interface SystemVoiceLike {
  name: string;
  lang: string;
  /** 浏览器标记的平台默认音色 */
  default?: boolean;
}

/** 中文优先的稳定排序:zh* 在前(zh-CN 先于 zh-TW),其余按 lang+name 字典序 */
export function sortVoicesZhFirst<T extends SystemVoiceLike>(voices: readonly T[]): T[] {
  const zhRank = (lang: string) => {
    const l = lang.toLowerCase();
    if (l === "zh-cn" || l === "zh_cn" || l === "zh") return 0;
    if (l.startsWith("zh")) return 1;
    return 2;
  };
  return [...voices].sort(
    (a, b) => zhRank(a.lang) - zhRank(b.lang) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name),
  );
}

/**
 * 选定 system 档音色:偏好名精确匹配 → 中文优先排序里的第一个,且偏好
 * default 标记(同档位内平台默认通常质量更好)→ 空表 null(渲染层报
 * engine-unavailable 引导,绝不静默无声)。
 */
export function pickSystemVoice<T extends SystemVoiceLike>(
  voices: readonly T[],
  preferredName: string | null | undefined,
): T | null {
  if (voices.length === 0) return null;
  const pref = preferredName?.trim();
  if (pref) {
    const hit = voices.find((v) => v.name === pref);
    if (hit) return hit;
  }
  const zh = sortVoicesZhFirst(voices.filter((v) => v.default));
  if (zh.length > 0 && isZhLang(zh[0]!.lang)) return zh[0];
  const sorted = sortVoicesZhFirst(voices);
  return sorted[0] ?? null;
}

function isZhLang(lang: string): boolean {
  return lang.toLowerCase().startsWith("zh");
}

/** 设置页下拉的显示名:"Huihui · zh-CN"(纯函数,渲染层直接用) */
export function systemVoiceLabel(v: SystemVoiceLike): string {
  return `${v.name} · ${v.lang}`;
}
