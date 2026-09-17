/**
 * shimeji-parse —— Shimeji 桌宠包解析(纯函数,零依赖,verify 可直测)。
 *
 * 两代格式同构,标签字典互查(SPEC-shimeji.md §1):
 *   日版原版(Group Finity): マスコット/動作/ポーズ/画像/基準座標/移動速度/長さ
 *   Shimeji-ee(英文复刻):   Mascot/Action/Pose/Image/ImageAnchor/Velocity/Duration
 * 实测样本:.shimeji-fixtures/{Eren Jaeger(日版), doraemon(ee)}。
 *
 * XML 手解策略:标签集合封闭(见字典),正则切 Action 块→块内提取 Pose 属性。
 * Embedded 動作可能带体(如 Dragged 带窗口参数子元素),不能假设自闭合。
 * 文件恒 UTF-8(可带 BOM),strip 后解析。
 */

export interface ShimejiPose {
  /** 帧文件名(相对 img/,含 "/shime1.png" 或 "shime1.png" 两种写法,归一为纯文件名) */
  image: string;
  /** 帧内锚点(通常=脚底点),像素坐标 */
  anchor: [number, number];
  /** 每 tick 位移(方向含朝向符号) */
  velocity: [number, number];
  /** 帧时长(tick) */
  duration: number;
}

export type ShimejiActionKind = "Embedded" | "Stay" | "Move" | "Animate" | "Sequence";

export interface ShimejiAction {
  name: string;
  kind: ShimejiActionKind;
  /** Embedded 类的 Java 类名(语义线索:Dragged/Regist/Fall...) */
  className?: string;
  /** 归档表英文标准名(v0.37.2 P0):日文包的语义判定/表情偏好统一键。
   *  解析时由 archiveOf(name) 反查烘焙;未收录动作(undefined=兜底 fx)。 */
  archiveOf?: string;
  /** 归档类别(v0.37.2):scene/fx/skip——调度器 fx 有帧进 idle、skip 永不进 */
  archive?: ActionArchive;
  /** Sequence(複合)子动作引用(v0.37.2 P2 摊平原料):引用名+可选时长。
   *  duration 语义:纯数字=ee 的 tick 字面量;表达式(${...})不可静态求值=undefined(保留子动作原节奏)。 */
  refs?: { name: string; duration?: number }[];
  poses: ShimejiPose[];
}

export interface ShimejiBehavior {
  name: string;
  /** 该行为被选中的权重(0=禁用) */
  frequency: number;
  /** 执行完本行为后的候选后续行为(Shimeji 的行为宏链条) */
  next: { name: string; frequency: number }[];
}

// ── 标签字典(日版/ee 双写法 → 语义键) ──

const ACTION_KIND_MAP: Record<string, ShimejiActionKind> = {
  "組み込み": "Embedded",
  Embedded: "Embedded",
  "静止": "Stay",
  Stay: "Stay",
  "移動": "Move",
  Move: "Move",
  "固定": "Animate",
  Animate: "Animate",
  "複合": "Sequence",
  Sequence: "Sequence",
};

function pickAttr(tag: string, names: string[]): string | undefined {
  for (const n of names) {
    const m = tag.match(new RegExp(`${n}="([^"]*)"`));
    if (m) return m[1];
  }
  return undefined;
}

function parsePoint(v: string | undefined): [number, number] {
  if (!v) return [0, 0];
  const parts = v.split(",").map((s) => Number(s.trim()));
  return [Number.isFinite(parts[0]) ? parts[0] : 0, Number.isFinite(parts[1]) ? parts[1] : 0];
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 归一帧文件名:"/shime1.png"/"img/shime1.png" → "shime1.png" */
function normalizeImage(v: string): string {
  const base = v.split("/").pop() ?? v;
  return base.trim();
}

/**
 * 解析 Actions.xml(actions.xml)为统一动作模型。
 * 双语言标签互查; Embedded 无 Animation 体时 poses=[]。
 */
export function parseShimejiActions(xml: string): ShimejiAction[] {
  const text = stripBom(xml);
  const actions: ShimejiAction[] = [];
  // 切 Action 块:从 <動作|<Action 开标签到配对的闭合。Embedded 多数自闭合,
  // 但带参数体的(如 Dragged)不是——按开标签顺序扫描,块 = 本开标签到下一个开标签或文件尾。
  const opens: number[] = [];
  const re = /<(?:動作|Action)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) opens.push(m.index);
  for (let i = 0; i < opens.length; i++) {
    const start = opens[i];
    const end = i + 1 < opens.length ? opens[i + 1] : text.length;
    const block = text.slice(start, end);
    const openTag = block.slice(0, block.indexOf(">") + 1);
    const name = pickAttr(openTag, ["名前", "Name"]);
    if (!name) continue;
    const kindRaw = pickAttr(openTag, ["種類", "Type"]) ?? "Embedded";
    const kind = ACTION_KIND_MAP[kindRaw] ?? "Embedded";
    const className = pickAttr(openTag, ["クラス", "Class"]);
    const poses: ShimejiPose[] = [];
    const poseRe = /<(?:ポーズ|Pose)(?=[\s/>])[^>]*>/g;
    let pm: RegExpExecArray | null;
    while ((pm = poseRe.exec(block))) {
      const attrs = pm[0].slice(1, -1);
      const image = normalizeImage(pickAttr(attrs, ["画像", "Image"]) ?? "");
      if (!image) continue;
      poses.push({
        image,
        anchor: parsePoint(pickAttr(attrs, ["基準座標", "ImageAnchor"])),
        velocity: parsePoint(pickAttr(attrs, ["移動速度", "Velocity"])),
        duration: Number(pickAttr(attrs, ["長さ", "Duration"]) ?? 1) || 1,
      });
    }
    // Sequence(複合)子动作引用:原版 <動作参照 名前 長さ> / ee <ActionReference Name Duration>
    const refs: { name: string; duration?: number }[] = [];
    if (kind === "Sequence") {
      const refRe = /<(?:動作参照|ActionReference)(?=[\s/>])[^>]*>/g;
      let rm: RegExpExecArray | null;
      while ((rm = refRe.exec(block))) {
        const attrs = rm[0].slice(1, -1);
        const refName = pickAttr(attrs, ["名前", "Name"]);
        if (!refName) continue;
        // Duration:纯数字字面量=ee tick 语义,收;表达式(${...} 随机时长)不可静态求值,
        // 置 undefined → 摊平时保留子动作原始帧节奏
        const durRaw = pickAttr(attrs, ["長さ", "Duration"]);
        const duration = durRaw && /^\d+$/.test(durRaw.trim()) ? Number(durRaw) : undefined;
        refs.push({ name: refName, ...(duration !== undefined ? { duration } : {}) });
      }
    }
    const archived = archiveOf(name);
    actions.push({
      name,
      kind,
      ...(className ? { className } : {}),
      ...(archived.entry ? { archiveOf: archived.entry.en, archive: archived.archive } : {}),
      ...(kind === "Sequence" ? { refs } : {}),
      poses,
    });
  }
  return actions;
}

/**
 * Sequence(複合)静态摊平(v0.37.2 P2):把组合动作的子动作 pose 链按引用顺序
 * 拼成单个可播动作,调度器随机池即可触达(此前 Sequence 不进任何池=永不演大头)。
 *
 * 规则:
 *   - 子动作仍为 Sequence → 递归展开(深度上限 8;环/超深/引用缺失 → 该动作保留原样,
 *     名字进 unexpanded 白名单,不炸导入);
 *   - 引用 duration 为纯数字(ee tick 字面量)→ 按比例缩放该子动作各 pose duration,
 *     使总时长≈duration;表达式/缺省 → 保留子动作原始节奏;
 *   - 摊平后 kind 重写:首叶子为 Move → Move,否则 Stay(自然进 walk/idle 池);
 *   - archiveOf 保留原动作自己的(名字没变,语义判定不受摊平影响)。
 */
export function expandShimejiSequences(
  actions: ShimejiAction[],
  maxDepth = 8,
): { actions: ShimejiAction[]; unexpanded: string[] } {
  const byName = new Map(actions.map((a) => [a.name, a]));
  const unexpanded: string[] = [];

  function flatten(name: string, stack: Set<string>, depth: number): ShimejiPose[] | null {
    if (depth > maxDepth || stack.has(name)) return null;
    const action = byName.get(name);
    if (!action) return null;
    if (action.kind !== "Sequence" || !action.refs?.length) return action.poses.map((p) => ({ ...p }));
    const inner = new Set(stack);
    inner.add(name);
    const out: ShimejiPose[] = [];
    for (const ref of action.refs) {
      const child = byName.get(ref.name);
      if (!child) return null;
      const childPoses = flatten(ref.name, inner, depth + 1);
      // 空 poses 叶子(无 body 的 Embedded 内置类,本应用无内置动画)→ 跳过该引用,
      // 不让整链失败(实测 Eren 包 64 複合里大量链含此类节点)
      if (!childPoses || childPoses.length === 0) continue;
      if (ref.duration !== undefined && ref.duration > 0) {
        // 按比例缩放该子动作帧时长,总时长≈引用 duration(tick)
        const total = childPoses.reduce((n, p) => n + p.duration, 0);
        if (total > 0) {
          const scale = ref.duration / total;
          for (const p of childPoses) p.duration = Math.max(1, Math.round(p.duration * scale));
        }
      }
      out.push(...childPoses);
    }
    return out.length ? out : null;
  }

  const result = actions.map((a) => {
    if (a.kind !== "Sequence") return a;
    const flattened = flatten(a.name, new Set(), 0);
    if (!flattened) {
      unexpanded.push(a.name);
      return a;
    }
    const firstLeafKind = findFirstLeafKind(a, byName, new Set(), 0, maxDepth);
    return {
      ...a,
      kind: firstLeafKind === "Move" ? ("Move" as const) : ("Stay" as const),
      poses: flattened,
      refs: undefined,
    };
  });
  return { actions: result, unexpanded };
}

/** 摊平后 kind 重写的依据:首叶子子动作的 kind(随机池按 Stay/Move 分流) */
function findFirstLeafKind(
  action: ShimejiAction,
  byName: Map<string, ShimejiAction>,
  stack: Set<string>,
  depth: number,
  maxDepth: number,
): ShimejiActionKind {
  const firstRef = action.refs?.[0];
  if (!firstRef) return "Stay";
  if (stack.has(firstRef.name) || depth > maxDepth) return "Stay";
  const child = byName.get(firstRef.name);
  if (!child) return "Stay";
  if (child.kind === "Sequence") {
    return findFirstLeafKind(child, byName, new Set(stack).add(action.name), depth + 1, maxDepth);
  }
  return child.kind;
}

/** 解析 Behavior.xml(behaviors.xml):行为触发频率表(0=禁用)。 */
export function parseShimejiBehaviors(xml: string): ShimejiBehavior[] {
  const text = stripBom(xml);
  const behaviors: ShimejiBehavior[] = [];
  const opens: number[] = [];
  const re = /<(?:行動|Behavior)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) opens.push(m.index);
  for (let i = 0; i < opens.length; i++) {
    const block = text.slice(opens[i], i + 1 < opens.length ? opens[i + 1] : text.length);
    const openTag = block.slice(0, block.indexOf(">") + 1);
    const name = pickAttr(openTag, ["名前", "Name"]);
    if (!name) continue;
    const frequency = Number(pickAttr(openTag, ["頻度", "Frequency"]) ?? 0) || 0;
    const next: { name: string; frequency: number }[] = [];
    const refRe = /<(?:行動参照|BehaviorReference)(?=[\s/>])[^>]*>/g;
    let rm: RegExpExecArray | null;
    while ((rm = refRe.exec(block))) {
      const n = pickAttr(rm[0], ["名前", "Name"]);
      if (n) next.push({ name: n, frequency: Number(pickAttr(rm[0], ["頻度", "Frequency"]) ?? 1) || 1 });
    }
    behaviors.push({ name, frequency, next });
  }
  return behaviors;
}

// ── 88 动作归档全表(SPEC-shimeji.md §2)──

export type ActionArchive = "scene" | "fx" | "skip";
/** scene 动作的驻留表面/语义槽位 */
export type SceneSlot =
  | "ground" | "wall" | "ceiling" | "mouse" | "panel"
  | "interact" | "celebrate" | "tired";

export interface ActionArchiveEntry {
  /** Shimeji-ee 英文名 */
  en: string;
  /** 日版原版名(同包一一对应) */
  ja: string;
  archive: ActionArchive;
  /** scene 归档的槽位(wall/ceiling/panel/mouse 二三期启用,一期只放 ground/interact) */
  slot?: SceneSlot;
  /** skip/fx 原因 */
  note?: string;
}

/** 88 全表。来源:实测 doraemon/conf/actions.xml(88 Action)与巨人包(88 動作)一一对应。 */
export const ACTION_ARCHIVE: ActionArchiveEntry[] = [
  // ── 地面系(scene·ground) ──
  { en: "Stand", ja: "立つ", archive: "scene", slot: "ground" },
  { en: "Walk", ja: "歩く", archive: "scene", slot: "ground" },
  { en: "Run", ja: "走る", archive: "scene", slot: "ground" },
  { en: "Dash", ja: "猛ダッシュ", archive: "scene", slot: "ground" },
  { en: "Sit", ja: "座る", archive: "scene", slot: "ground" },
  { en: "SitAndLookUp", ja: "座って見上げる", archive: "scene", slot: "ground" },
  { en: "SitWithLegsUp", ja: "楽に座る", archive: "scene", slot: "ground" },
  { en: "SitWithLegsDown", ja: "足を下ろして座る", archive: "scene", slot: "ground" },
  { en: "SitAndDangleLegs", ja: "座って足をぶらぶらさせる", archive: "scene", slot: "ground" },
  { en: "Sprawl", ja: "寝そべる", archive: "scene", slot: "ground", note: "学习者没劲→躺平(伴学事件)" },
  { en: "Creep", ja: "ずりずり", archive: "scene", slot: "ground" },
  { en: "WalkAlongWorkAreaFloor", ja: "ワークエリアの下辺を歩く", archive: "scene", slot: "ground" },
  { en: "RunAlongWorkAreaFloor", ja: "ワークエリアの下辺を走る", archive: "scene", slot: "ground" },
  { en: "CrawlAlongWorkAreaFloor", ja: "ワークエリアの下辺でずりずり", archive: "scene", slot: "ground" },
  { en: "WalkLeftAlongFloorAndSit", ja: "ワークエリアの下辺の左の端っこで座る", archive: "scene", slot: "ground" },
  { en: "WalkRightAlongFloorAndSit", ja: "ワークエリアの下辺の右の端っこで座る", archive: "scene", slot: "ground" },
  { en: "WalkLeftAndSit", ja: "走ってワークエリアの下辺の左の端っこで座る", archive: "scene", slot: "ground" },
  { en: "WalkRightAndSit", ja: "走ってワークエリアの下辺の右の端っこで座る", archive: "scene", slot: "ground" },
  // ── 交互系(scene·interact/celebrate/tired) ──
  { en: "Fall", ja: "落下する", archive: "scene", slot: "interact" },
  { en: "Falling", ja: "落ちる", archive: "scene", slot: "interact" },
  { en: "Dragged", ja: "ドラッグされる", archive: "scene", slot: "interact" },
  { en: "Thrown", ja: "投げられる", archive: "scene", slot: "interact" },
  { en: "Resisting", ja: "抵抗する", archive: "scene", slot: "interact" },
  { en: "Pinched", ja: "つままれる", archive: "scene", slot: "interact" },
  { en: "Bouncing", ja: "跳ねる", archive: "scene", slot: "celebrate" },
  { en: "Jumping", ja: "ジャンプ", archive: "scene", slot: "celebrate" },
  { en: "Tripping", ja: "転ぶ", archive: "scene", slot: "interact", note: "球撞反应帧" },
  // ── 墙壁系(scene·wall,二期) ──
  { en: "GrabWall", ja: "壁に掴まる", archive: "scene", slot: "wall" },
  { en: "ClimbWall", ja: "壁を登る", archive: "scene", slot: "wall" },
  { en: "ClimbHalfwayAlongWall", ja: "ワークエリアの壁を途中まで登る", archive: "scene", slot: "wall" },
  { en: "ClimbAlongWall", ja: "ワークエリアの壁を登る", archive: "scene", slot: "wall" },
  { en: "FallFromWall", ja: "壁から落ちる", archive: "scene", slot: "wall" },
  { en: "GrabWorkAreaBottomLeftWall", ja: "ワークエリアの下辺から左の壁によじのぼる", archive: "scene", slot: "wall" },
  { en: "GrabWorkAreaBottomRightWall", ja: "ワークエリアの下辺から右の壁によじのぼる", archive: "scene", slot: "wall" },
  { en: "WalkAndGrabBottomLeftWall", ja: "走ってワークエリアの下辺から左の壁によじのぼる", archive: "scene", slot: "wall" },
  { en: "WalkAndGrabBottomRightWall", ja: "走ってワークエリアの下辺から右の壁によじのぼる", archive: "scene", slot: "wall" },
  { en: "HoldOntoWall", ja: "壁に掴まってボーっとする", archive: "scene", slot: "wall" },
  { en: "JumpFromLeftWall", ja: "左の壁に飛びつく", archive: "scene", slot: "wall" },
  { en: "JumpFromRightWall", ja: "右の壁に飛びつく", archive: "scene", slot: "wall" },
  // ── 天花板系(scene·ceiling,二期) ──
  { en: "GrabCeiling", ja: "天井に掴まる", archive: "scene", slot: "ceiling" },
  { en: "ClimbCeiling", ja: "天井を伝う", archive: "scene", slot: "ceiling" },
  { en: "HoldOntoCeiling", ja: "天井に掴まってボーっとする", archive: "scene", slot: "ceiling" },
  { en: "FallFromCeiling", ja: "天井から落ちる", archive: "scene", slot: "ceiling" },
  { en: "ClimbAlongCeiling", ja: "ワークエリアの上辺を伝う", archive: "scene", slot: "ceiling" },
  // ── 鼠标系(scene·mouse,二期) ──
  { en: "ChaseMouse", ja: "マウスの周りに集まる", archive: "scene", slot: "mouse" },
  { en: "SitAndLookAtMouse", ja: "座ってマウスのほうを見る", archive: "scene", slot: "mouse" },
  { en: "SitAndFaceMouse", ja: "座ってマウスのほうを見てたら首が回った", archive: "scene", slot: "mouse" },
  // ── 花活(fx:播动画,无位移语义) ──
  { en: "SplitIntoTwo", ja: "分裂する", archive: "fx", note: "播动画不生成第二只(单生物设定)" },
  { en: "Divided", ja: "分裂した", archive: "fx" },
  { en: "PullUpShimeji", ja: "引っこ抜く", archive: "fx" },
  { en: "PullUpShimeji1", ja: "引っこ抜く1", archive: "fx" },
  { en: "PullUpShimeji2", ja: "引っこ抜く2", archive: "fx" },
  { en: "PullUp", ja: "引っこ抜かれる", archive: "fx" },
  { en: "Look", ja: "振り向く", archive: "fx", note: "朝向切换内部用" },
  { en: "StandUp", ja: "立ってボーっとする", archive: "fx" },
  { en: "LieDown", ja: "寝そべってボーっとする", archive: "fx", slot: "tired" },
  { en: "SitWhileDanglingLegs", ja: "座って足をぶらぶらさせる(複合)", archive: "fx" },
  { en: "Bouncing-", ja: "跳ねる(複合)", archive: "fx" },
  // ── IE/窗口系列(scene·panel,三期;宿主=页面面板) ──
  { en: "WalkAlongIECeiling", ja: "IEの天井を歩く", archive: "scene", slot: "panel" },
  { en: "RunAlongIECeiling", ja: "IEの天井を走る", archive: "scene", slot: "panel" },
  { en: "CrawlAlongIECeiling", ja: "IEの天井でずりずり", archive: "scene", slot: "panel" },
  { en: "SitOnTheLeftEdgeOfIE", ja: "IEの天井の左の端っこで座る", archive: "scene", slot: "panel" },
  { en: "SitOnTheRightEdgeOfIE", ja: "IEの天井の右の端っこで座る", archive: "scene", slot: "panel" },
  { en: "JumpFromLeftEdgeOfIE", ja: "IEの天井の左の端っこから飛び降りる", archive: "scene", slot: "panel" },
  { en: "JumpFromRightEdgeOfIE", ja: "IEの天井の右の端っこから飛び降りる", archive: "scene", slot: "panel" },
  { en: "WalkLeftAlongIEAndSit", ja: "走ってIEの天井の左の端っこで座る", archive: "scene", slot: "panel" },
  { en: "WalkRightAlongIEAndSit", ja: "走ってIEの天井の右の端っこで座る", archive: "scene", slot: "panel" },
  { en: "WalkLeftAlongIEAndJump", ja: "走ってIEの天井の左の端っこから飛び降りる", archive: "scene", slot: "panel" },
  { en: "WalkRightAlongIEAndJump", ja: "走ってIEの天井の右の端っこから飛び降りる", archive: "scene", slot: "panel" },
  { en: "DashIeCeilingLeftEdgeFromJump", ja: "猛ダッシュでIEの天井の左の端っこから飛び降りる", archive: "scene", slot: "panel" },
  { en: "DashIeCeilingRightEdgeFromJump", ja: "猛ダッシュでIEの天井の右の端っこから飛び降りる", archive: "scene", slot: "panel" },
  { en: "HoldOntoIEWall", ja: "IEの壁を途中まで登る", archive: "scene", slot: "panel" },
  { en: "ClimbIEWall", ja: "IEの壁を登る", archive: "scene", slot: "panel" },
  { en: "ClimbIEBottom", ja: "IEの下辺を伝う", archive: "scene", slot: "panel" },
  { en: "GrabIEBottomLeftWall", ja: "IEの下辺から左の壁によじのぼる", archive: "scene", slot: "panel" },
  { en: "GrabIEBottomRightWall", ja: "IEの下辺から右の壁によじのぼる", archive: "scene", slot: "panel" },
  { en: "JumpOnIELeftWall", ja: "IEの左に飛びつく", archive: "scene", slot: "panel" },
  { en: "JumpOnIERightWall", ja: "IEの右に飛びつく", archive: "scene", slot: "panel" },
  { en: "JumpFromBottomOfIE", ja: "IEの下に飛びつく", archive: "scene", slot: "panel" },
  { en: "ThrowIEFromLeft", ja: "IEを左に投げる", archive: "skip", note: "扔窗口无对应宿主行为" },
  { en: "ThrowIEFromRight", ja: "IEを右に投げる", archive: "skip", note: "扔窗口无对应宿主行为" },
  { en: "WalkAndThrowIEFromLeft", ja: "走ってIEを左に投げる", archive: "skip", note: "扔窗口无对应宿主行为" },
  { en: "WalkAndThrowIEFromRight", ja: "走ってIEを右に投げる", archive: "skip", note: "扔窗口无对应宿主行为" },
  { en: "FallWithIe", ja: "IEを持って落ちる", archive: "skip", note: "IE 专属内置动作" },
  { en: "SitDown", ja: "座ってボーっとする", archive: "scene", slot: "ground" },
  { en: "SitAndSpinHeadAction", ja: "座って首が回る", archive: "fx" },
  { en: "SitAndSpinHead", ja: "座ってマウスのほうを見てたら首が回った", archive: "scene", slot: "mouse" },
  { en: "Divide1", ja: "分裂1", archive: "fx" },
  { en: "WalkWithIe", ja: "IEを持って歩く", archive: "skip", note: "IE 专属内置动作" },
  { en: "RunWithIe", ja: "IEを持って走る", archive: "skip", note: "IE 专属内置动作" },
  { en: "ThrowIe", ja: "IEを投げる", archive: "skip", note: "IE 专属内置动作" },
  // ── 内置辅助(解析层内部,不上映射) ──
  { en: "SitAndLookUpAtMouse", ja: "座ってマウスを見上げる", archive: "scene", slot: "mouse" },
  { en: "DangleLegs", ja: "足をぶらぶらさせる", archive: "fx" },
  { en: "Offset", ja: "変位", archive: "fx", note: "位移动作内部用" },
];

/**
 * 动作归档查询:en/ja 双向。未收录的动作按 SPEC 兜底 fx(可播无位移,不崩)。
 */
export function archiveOf(actionName: string): { entry: ActionArchiveEntry | null; archive: ActionArchive; slot?: SceneSlot } {
  const hit = ACTION_ARCHIVE.find((e) => e.en === actionName || e.ja === actionName);
  if (hit) return { entry: hit, archive: hit.archive, ...(hit.slot ? { slot: hit.slot } : {}) };
  return { entry: null, archive: "fx" };
}
