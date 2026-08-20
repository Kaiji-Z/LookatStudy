/**
 * pet-sfx —— 伴学宠物音效(WebAudio 合成,零资产零 IPC)。
 *
 * 短促"啾/哔"系宠物声,不是语言:戳/开心/被拍/落地/抓住 各一枚,
 * 低音量(增益 0.06)不打扰。AudioContext 惰性创建,首次在用户手势内
 * 触发(poke/点击)自动 resume。开关走设置 companion_sfx(默认开),
 * bus 加载/配置变更时调 setPetSfxEnabled。
 */

let ctx: AudioContext | null = null;
let enabled = true;

/** bus 在加载设置/companion-config-changed 时写入。 */
export function setPetSfxEnabled(on: boolean): void {
  enabled = on;
}

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * 单音:频率滑奏(from→to)+ 包络(快起慢收)。
 * 纯合成参数在函数内,不暴露——音色即品牌。
 */
function tone(
  c: AudioContext,
  fromHz: number,
  toHz: number,
  durMs: number,
  type: OscillatorType,
  delayMs = 0,
): void {
  const t0 = c.currentTime + delayMs / 1000;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(fromHz, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, toHz), t0 + durMs / 1000);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durMs / 1000 + 0.02);
}

export type PetSfxName = "poke" | "happy" | "ouch" | "land" | "grab";

/** 播一枚宠物音。开关关闭/上下文不可用时静默。 */
export function playPetSfx(name: PetSfxName): void {
  if (!enabled) return;
  const c = ensureCtx();
  if (!c) return;
  switch (name) {
    case "poke":
      tone(c, 660, 990, 110, "triangle");
      break;
    case "happy": // 两连升调"啾!"
      tone(c, 523, 660, 80, "triangle");
      tone(c, 784, 988, 110, "triangle", 85);
      break;
    case "ouch": // 下滑"哎哟"
      tone(c, 440, 180, 200, "sawtooth");
      break;
    case "land": // 落地闷"噗"
      tone(c, 200, 120, 70, "square");
      break;
    case "grab": // 被抓住"哼!"
      tone(c, 330, 300, 90, "triangle");
      break;
  }
}
