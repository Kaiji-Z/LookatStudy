/**
 * forms/registry —— 形象 id → 形态组件的唯一注册处。
 *
 * 加新形象三步:① forms/ 下写组件(遵守 shared.tsx 的 refs/class 契约)
 * ② 这里注册 ③ forms-index.ts 的 COMPANION_FORM_IDS 加 id + i18n 补键
 * + SettingsView 选择卡自动渲染(遍历清单)。verify T12 守卫三处咬合。
 */
import type { ComponentType } from "react";

import type { CompanionFormId } from "../../../lib/companion/forms-index.js";
import type { FormArtProps } from "./shared.js";
import { EmberArt } from "./ember.js";
import { FrostArt } from "./frost.js";
import { MossArt } from "./moss.js";
import { AstroArt } from "./astro.js";
import { InkArt } from "./ink.js";
import { CustomPuppetArt } from "./custom-puppet.js";
import { ShimejiArt } from "./shimeji-form.js";

export const FORM_ART: Record<CompanionFormId, ComponentType<FormArtProps>> = {
  ember: EmberArt,
  frost: FrostArt,
  moss: MossArt,
  astro: AstroArt,
  ink: InkArt,
  /** M2:用户导入的纸偶包(SPEC §16)——切分件 <image> 分层 + HoverDisc。 */
  custom: CustomPuppetArt,
  /** 第 7 形态:导入的 Shimeji 桌宠包(帧动画+独立调度,SPEC-shimeji.md)。 */
  shimeji: ShimejiArt,
};
