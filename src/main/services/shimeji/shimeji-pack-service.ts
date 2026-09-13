/**
 * shimeji-pack-service —— Shimeji 桌宠包导入/管理(第七形态,SPEC-shimeji.md §4)。
 *
 * zip 唯一入口:unzip → 角色目录发现(conf/Actions.xml|actions.xml + img/)→
 * staging 清单(多角色勾选)→ confirm 落盘 userData/shimeji-packs/<packId>/。
 * 帧图原样拷贝(不解码不重编码——像素与作者意图都是包的一部分)。
 */
import { join, dirname } from "node:path";
import { mkdir, readFile, writeFile, rm, readdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { safeEntryDest, unzipGuardFilter } from "../pure/entry-guard.js";
import type { CompanionVehicleId } from "../../../../shared/companion-cut.js";
import type { SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../../db/schema.js";
import { settings } from "../../db/schema.js";
import { eq } from "drizzle-orm";

type Db = SQLJsDatabase<typeof schema>;
import {
  parseShimejiActions,
  parseShimejiBehaviors,
  archiveOf,
  type SceneSlot,
  type ShimejiAction,
} from "./pure/shimeji-parse.js";

/** settings 单键读写(项目无全局 helper,各服务直用表,lang-pref 同款) */
function getSetting(db: Db, key: string): string | null {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}
function setSetting(db: Db, key: string, value: string): void {
  const existing = db.select().from(settings).where(eq(settings.key, key)).get();
  if (existing) db.update(settings).set({ value }).where(eq(settings.key, key)).run();
  else db.insert(settings).values({ key, value }).run();
}

export interface ShimejiCharacterSummary {
  /** staging 内角色目录相对路径(confirm 时回传) */
  ref: string;
  name: string;
  iconBase64: string | null;
  frameCount: number;
  actionCount: number;
  /** "原版" | "ee" */
  format: string;
}

export interface ShimejiImportPreview {
  importId: string;
  characters: ShimejiCharacterSummary[];
}

export interface ShimejiPackManifest {
  id: string;
  name: string;
  format: string;
  /** 角色目录内 img/ 相对帧文件 */
  frames: string[];
  actions: (ShimejiAction & { slot?: SceneSlot })[];
  behaviors: { name: string; frequency: number; next: { name: string; frequency: number }[] }[];
  archiveVersion: number;
  importedAt: string;
  /** 载具主题(机械臂同链换装;缺省 silver) */
  vehicle?: CompanionVehicleId;
}

export interface ShimejiPackSummary {
  id: string;
  name: string;
  format: string;
  frameCount: number;
  actionCount: number;
  vehicle?: CompanionVehicleId;
  iconBase64: string | null;
  active: boolean;
}

function packsRoot(dataDir: string): string {
  return join(dataDir, "shimeji-packs");
}

function stagingRoot(dataDir: string): string {
  return join(packsRoot(dataDir), ".staging");
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 发现的角色:ref=staging 相对回传键,imgPrefix=帧所在目录前缀,配置根 */
export interface DiscoveredCharacter {
  /** conf 所在目录("" = zip 根) */
  confDir: string;
  /** 帧目录前缀:"img" 或 "img/<品种>"(引擎布局) */
  imgPrefix: string;
  name: string;
  actionsPath: string;
}

/**
 * 角色发现,兼容两种实测布局:
 *   自包含型(巨人包):"<角色>/conf/Actions.xml" + "<角色>/img/" → 角色=<角色>
 *   引擎布局(Doraemon):根 "conf/actions.xml" + "img/<品种>/帧" → 角色=每个 img 子目录
 */
function discoverCharacters(files: Record<string, Uint8Array>): DiscoveredCharacter[] {
  const out: DiscoveredCharacter[] = [];
  const confPaths = Object.keys(files).filter((p) => /(^|\/)conf\/[Aa]ctions\.xml$/.test(p));
  for (const actionsPath of confPaths) {
    const confDir = actionsPath.replace(/conf\/[Aa]ctions\.xml$/, "").replace(/\/$/, "");
    const selfImg = confDir ? `${confDir}/img` : "img";
    // 自包含判定 = 帧直接在 img/ 直下(rest 无子目录);帧在 img/<品种>/ 的是引擎布局
    const hasSelfImg = Object.keys(files).some((p) => {
      if (!p.startsWith(`${selfImg}/`) || !p.endsWith(".png")) return false;
      const rest = p.slice(selfImg.length + 1);
      if (rest.includes("/")) return false;
      return rest.toLowerCase() !== "icon.png"; // icon 是包级资产,不证明自包含
    });
    if (hasSelfImg) {
      out.push({
        confDir,
        imgPrefix: selfImg,
        name: confDir.split("/").pop() ?? "Shimeji",
        actionsPath,
      });
      continue;
    }
    // 引擎布局:conf 在根(或任意层),帧在 <confDir>/img/<品种>/ 下,每品种一角色
    const imgBase = confDir ? `${confDir}/img` : "img";
    const breeds = new Set<string>();
    for (const p of Object.keys(files)) {
      if (!p.startsWith(`${imgBase}/`) || !p.endsWith(".png")) continue;
      const rest = p.slice(imgBase.length + 1);
      const breed = rest.includes("/") ? rest.split("/")[0] : "";
      if (breed) breeds.add(breed);
    }
    for (const breed of [...breeds].sort()) {
      out.push({ confDir, imgPrefix: `${imgBase}/${breed}`, name: breed, actionsPath });
    }
  }
  return out;
}

function detectFormat(actionsXmlPath: string, xml: string): string {
  const base = actionsXmlPath.split("/").pop() ?? "";
  if (base === "Actions.xml" && xml.includes("マスコット")) return "原版";
  if (xml.includes("<Mascot")) return "ee";
  return xml.includes("動作") ? "原版" : "ee";
}

/**
 * Step 1:zip → 解压到 staging → 角色清单(不落正式包,等用户勾选)。
 */
export async function importShimejiZip(db: Db, dataDir: string, zipBase64: string): Promise<ShimejiImportPreview> {
  const zipBuf = Buffer.from(zipBase64, "base64");
  const entries = unzipSync(new Uint8Array(zipBuf), {
    // zip-bomb 滤网(2026-09-13 审计):2GB 声明解压总量/20000 条目,超限条目不解压
    filter: unzipGuardFilter(2 * 1024 ** 3, 20_000),
  });
  const files: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith("__MACOSX") && !path.endsWith("/")) files[path.replace(/\\/g, "/")] = data;
  }
  const chars = discoverCharacters(files);
      if (chars.length === 0) throw new Error("未找到 Shimeji 角色目录(需含 conf/Actions.xml 与 img/)");

  const importId = randomUUID().slice(0, 8);
  const stagingDir = join(stagingRoot(dataDir), importId);
  await mkdir(stagingDir, { recursive: true });
  // staging 保留完整解压树(confirm 时从这拷选中角色)。
  // 条目名是 zip 内攻击者可控字符串:穿越/绝对路径/盘符一律丢弃(2026-09-13 审计 P0 修复)
  for (const [path, data] of Object.entries(files)) {
    const target = safeEntryDest(stagingDir, path);
    if (!target) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }

  const characters: ShimejiCharacterSummary[] = chars.map((c) => {
    const xml = new TextDecoder().decode(files[c.actionsPath]);
    const actions = parseShimejiActions(xml);
    const frames = Object.keys(files).filter((p) => p.startsWith(`${c.imgPrefix}/`) && p.endsWith(".png") && !p.toLowerCase().endsWith("icon.png"));
    const iconPath = `${c.imgPrefix}/icon.png`;
    return {
      ref: c.imgPrefix,
      name: c.name,
      iconBase64: files[iconPath] ? Buffer.from(files[iconPath]).toString("base64") : null,
      frameCount: frames.length,
      actionCount: actions.length,
      format: detectFormat(c.actionsPath, xml),
    };
  });

  void db;
  return { importId, characters };
}

/**
 * Step 2:用户勾选后,从 staging 把选中角色落成正式包。
 */
export async function confirmShimejiImport(
  _db: Db,
  dataDir: string,
  importId: string,
  characterRefs: string[],
): Promise<ShimejiPackSummary[]> {
  if (!/^[0-9a-f]{8}$/.test(importId)) throw new Error(`非法导入会话 id: ${importId}`);
  const stagingDir = join(stagingRoot(dataDir), importId);
  if (!existsSync(stagingDir)) throw new Error(`导入会话不存在或已过期: ${importId}`);
  const created: ShimejiPackSummary[] = [];
  for (const ref of characterRefs) {
    // ref = staging 内帧目录前缀("img" / "<角色>/img" / "img/<品种>" / "<角色>/img/<品种>")
    // conf 在 ref 去掉 /img 与品种段的那层(引擎布局 conf 可在根或角色目录内)
    const srcImgDir = safeEntryDest(stagingDir, ref);
    if (!srcImgDir || !existsSync(srcImgDir)) continue;
    const name = ref.split("/").pop() ?? ref;
    const confDir = /\/img(\/[^/]+)?$/.test(ref) ? ref.replace(/\/img(\/[^/]+)?$/, "") : "";
    const actionsPath = ["Actions.xml", "actions.xml"]
      .map((f) => join(stagingDir, confDir, "conf", f))
      .find((p) => existsSync(p))!;
    const xml = await readFile(actionsPath, "utf8");
    const format = detectFormat(actionsPath, xml);
    const actions = parseShimejiActions(xml).map((a) => ({ ...a, slot: archiveOf(a.name).slot }));
    const behPath = ["Behavior.xml", "behaviors.xml"].map((f) => join(stagingDir, confDir, "conf", f)).find((p) => existsSync(p));
    const behaviors = behPath ? parseShimejiBehaviors(await readFile(behPath, "utf8")) : [];

    const packId = `shimeji-${randomUUID().slice(0, 8)}`;
    const packDir = join(packsRoot(dataDir), packId);
    await mkdir(packDir, { recursive: true });
    await cp(srcImgDir, join(packDir, "img"), { recursive: true });

    const imgFiles = (await readdir(join(packDir, "img"))).filter((f) => f.endsWith(".png") && !f.toLowerCase().endsWith("icon.png"));
    const manifest: ShimejiPackManifest = {
      id: packId,
      name,
      format,
      frames: imgFiles,
      actions,
      behaviors,
      archiveVersion: 1,
      importedAt: new Date().toISOString(),
    };
    await writeFile(join(packDir, "manifest.json"), JSON.stringify(manifest));
    created.push({
      id: packId,
      name,
      format,
      frameCount: imgFiles.length,
      actionCount: actions.length,
      iconBase64: existsSync(join(packDir, "img", "icon.png"))
        ? (await readFile(join(packDir, "img", "icon.png"))).toString("base64")
        : null,
      active: false,
    });
  }
  // staging 用完即弃
  await rm(stagingDir, { recursive: true, force: true });
  return created;
}

/** 包清单读取(渲染层运行时用:帧图+动作+行为) */
export async function getShimejiPack(_db: Db, dataDir: string, packId: string): Promise<ShimejiPackManifest | null> {
  if (!/^shimeji-[0-9a-f]{8}$/.test(packId)) return null; // id 形状守卫(防路径穿越)
  return readJson<ShimejiPackManifest>(join(packsRoot(dataDir), packId, "manifest.json"));
}

/** 包清单列表(设置页包卡) */
export async function listShimejiPacks(db: Db | null, dataDir: string): Promise<ShimejiPackSummary[]> {
  const root = packsRoot(dataDir);
  if (!existsSync(root)) return [];
  const activeId = db ? (getSetting(db, "shimeji_active_pack") ?? null) : null;
  const out: ShimejiPackSummary[] = [];
  for (const dir of (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith("."))) {
    const manifest = await readJson<ShimejiPackManifest>(join(root, dir.name, "manifest.json"));
    if (!manifest) continue;
    let iconBase64: string | null = null;
    try {
      iconBase64 = (await readFile(join(root, dir.name, "img", "icon.png"))).toString("base64");
    } catch {
      /* 无 icon:头像占位 */
    }
    out.push({
      id: manifest.id,
      name: manifest.name,
      format: manifest.format,
      frameCount: manifest.frames.length,
      actionCount: manifest.actions.length,
      iconBase64,
      active: manifest.id === activeId,
      vehicle: manifest.vehicle,
    });
  }
  return out;
}

/** 激活包(settings;帧渲染层经 shimeji:getActive 取 manifest) */
export async function activateShimejiPack(db: Db, packId: string): Promise<void> {
  setSetting(db, "shimeji_active_pack", packId);
}

const VEH_WHITELIST: ReadonlySet<string> = new Set(["silver", "ember", "frost", "moss", "astro", "ink"]);

/** 换载具主题(机械臂同链):写回包 manifest.json;激活包即时换装由渲染层 refresh 驱动 */
export async function setVehicleShimeji(db: Db, dataDir: string, packId: string, vehicle: string): Promise<{ ok: boolean }> {
  if (!/^shimeji-[0-9a-f]{8}$/.test(packId)) return { ok: false };
  if (!VEH_WHITELIST.has(vehicle)) return { ok: false };
  const file = join(packsRoot(dataDir), packId, "manifest.json");
  const manifest = await readJson<ShimejiPackManifest>(file);
  if (!manifest) return { ok: false };
  manifest.vehicle = vehicle as CompanionVehicleId;
  await writeFile(file, JSON.stringify(manifest));
  void db;
  return { ok: true };
}

export async function deleteShimejiPack(db: Db, dataDir: string, packId: string): Promise<void> {
  if (!/^shimeji-[0-9a-f]{8}$/.test(packId)) return;
  if ((getSetting(db, "shimeji_active_pack") ?? null) === packId)
    db.delete(settings).where(eq(settings.key, "shimeji_active_pack")).run();
  await rm(join(packsRoot(dataDir), packId), { recursive: true, force: true });
}

/** 渲染层运行时取当前激活包完整 manifest */
export async function getActiveShimejiPack(db: Db, dataDir: string): Promise<ShimejiPackManifest | null> {
  const activeId = getSetting(db, "shimeji_active_pack") ?? null;
  if (!activeId) return null;
  return getShimejiPack(db, dataDir, activeId);
}

/** 单帧图读取(base64;渲染层按 Pose.Image 惰性取) */
export async function getShimejiFrameDataUrl(
  _db: Db,
  dataDir: string,
  packId: string,
  frame: string,
): Promise<string | null> {
  if (!/^shimeji-[0-9a-f]{8}$/.test(packId)) return null;
  if (!/^[\w.-]+\.png$/i.test(frame)) return null; // 文件名守卫
  try {
    const buf = await readFile(join(packsRoot(dataDir), packId, "img", frame));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// archiveOf 再导出(协议层给渲染层标 scene 动作用)
export { archiveOf };
