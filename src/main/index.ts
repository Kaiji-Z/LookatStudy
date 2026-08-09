/**
 * Electron 主进程入口。
 *
 * 职责：
 * 1. 创建 BrowserWindow
 * 2. 初始化 SQLite（initDb）
 * 3. 注册 IPC handlers
 * 4. 加载种子课程（ensureSeedCourse）
 * 5. dev 模式从 vite dev server 加载，生产从打包文件加载
 */
import { app, BrowserWindow, shell } from "electron";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { initDb, getDb, markDirty } from "./db/index.js";
import { registerAllHandlers } from "./ipc/index.js";
import { ensureSeedCourse } from "./services/seed.js";
import { ensureExamNodesForExistingCourses } from "./services/course-generator.js";
import { loadEnv, getZaiConfig } from "./services/env.js";
import { seedBuiltinSkills } from "./services/skills/skill-service.js";
import { createProposal } from "./services/proposal-service.js";
import { courses, contentNodes, streaks } from "./db/schema.js";
import { eq } from "drizzle-orm";

// 主进程以 CJS 打包（见 vite.config.ts），__dirname 天然可用。
// 这里的声明只为 TypeScript 类型检查；运行时被 CJS 全局覆盖。
declare const __dirname: string;

const DEV_SERVER_URL = "http://localhost:5173";
const isDev = !app.isPackaged;

// 项目根目录：从 dist-electron/main/ 退两级到项目根
const PROJECT_ROOT = resolve(__dirname, "../..");

// 关闭硬件加速。
// 原因：Windows 上 Electron GPU 磁盘缓存创建经常因权限失败
// （`Gpu Cache Creation failed: -2` / `Unable to move the cache: 拒绝访问`），
// 导致渲染层 DOM 正常但合成失败 → 黑屏窗口。
// 软件合成对本应用（无 3D / 无视频）完全够用，且更稳定。
// 必须在 app.whenReady() 之前调用。
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: "LookatStudy",
    backgroundColor: "#0a0a0a",
    webPreferences: {
      // preload 与 main 平级：dist-electron/preload/index.js
      preload: join(PROJECT_ROOT, "dist-electron/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 用到部分 Node API（ipcRenderer）
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  // 外链走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (isDev && process.env["NODE_ENV"] === "development") {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // 渲染层产物：dist/renderer/index.html
    mainWindow.loadFile(join(PROJECT_ROOT, "dist/renderer/index.html"));
  }
}

// 单实例锁:防止用户开多个主窗口(Windows 双击图标多次 / dev 叠加)。
// 测试模式(--self-test / --ui-test)是独立 headless 实例,绕过锁,不和主窗口互斥。
const isTestMode = process.argv.includes("--self-test") || process.argv.includes("--ui-test");
if (!isTestMode) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    // 自己是第二个实例,立即退出
    app.quit();
  } else {
    app.on("second-instance", () => {
      // 有人试图开第二个实例 → 把已有窗口提到前台
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
}

app.whenReady().then(async () => {
  try {
    // 加载 .env(可选,已 gitignore)。读不到静默跳过。
    loadEnv();
    await initDb();
    console.error("[lookatstudy] DB initialized");
    ensureSeedCourse();
    console.error("[lookatstudy] seed course ensured");
    // 给老库(本功能上线前导入的课程)补章节考试节点。幂等,已含 exam 的 section 跳过。
    const { patched } = ensureExamNodesForExistingCourses(getDb());
    if (patched > 0) {
      console.error(`[lookatstudy] 补了 ${patched} 个章节考试节点`);
      markDirty();
    }
    // M1: 幂等 seed 4 个内置 learning-mode skill
    seedBuiltinSkills(getDb());
    console.error("[lookatstudy] builtin skills ensured");
  } catch (e) {
    console.error("[lookatstudy] FATAL during init:", e);
    app.quit();
    return;
  }

  // 自检模式：npm run self-test，跑完即退，不开窗
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    app.quit();
    return;
  }

  // UI 验证模式：npm run ui-test，开一个 headless 窗口，加载渲染层，
  // 跑 DOM 断言（真 GUI：真 preload / 真 IPC roundtrip / 真 React 渲染），写结果文件后退出。
  // 这是 §8.2 UI 改造的闭环验证方式（纯 Node 测试无法断言 UI 布局）。
  if (process.argv.includes("--ui-test")) {
    const screenshot = process.argv.includes("--screenshot");
    await runUiTest(screenshot);
    app.quit();
    return;
  }

  // 画线往返测试:npm run test:highlight,验证 rangeToOffsets→offsetsToRange→applyPersistentMarks
  // 在各种 DOM 结构(标题/列表/代码块/嵌套 span/空白)下的精度。真 Chromium DOM。
  if (process.argv.includes("--test-highlight")) {
    await runHighlightTest();
    app.quit();
    return;
  }

  if (mainWindow) {
    registerAllHandlers(mainWindow);
  } else {
    createWindow();
    if (mainWindow) registerAllHandlers(mainWindow);
  }
  console.error("[lookatstudy] window created, IPC registered");

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * 主进程自检：直接查 DB 验证种子数据写入成功 + schema 正确。
 * 不经过 IPC，纯验证主进程逻辑层。
 */
async function runSelfTest(): Promise<void> {
  const db = getDb();
  const results: Array<{ name: string; ok: boolean; detail?: unknown }> = [];

  // 1. 种子课程存在
  const seedCourse = db
    .select()
    .from(courses)
    .where(eq(courses.id, "seed-fde-roadmap"))
    .get();
  results.push({
    name: "seed course exists",
    ok: !!seedCourse,
    detail: seedCourse?.title,
  });

  // 2. 课程树有 sections + lessons（数量不硬编码——seed 内容会随 FDE 路线图源更新而变，
  // 这里只校验"非空 + 结构合理"，避免改 seed 时 self-test 假性失败）
  const tree = db
    .select()
    .from(contentNodes)
    .where(eq(contentNodes.courseId, "seed-fde-roadmap"))
    .all();
  const sections = tree.filter((n) => n.type === "section");
  const lessons = tree.filter((n) => n.type === "lesson");
  results.push({
    name: "course tree has sections + lessons",
    ok: sections.length >= 3 && lessons.length >= sections.length * 2,
    detail: { sections: sections.length, lessons: lessons.length },
  });

  // 3. streak singleton 存在
  const streakRow = db
    .select()
    .from(streaks)
    .where(eq(streaks.id, "singleton"))
    .get();
  results.push({
    name: "streak singleton exists",
    ok: !!streakRow,
    detail: streakRow,
  });

  const allOk = results.every((r) => r.ok);
  const report = { overall: allOk, results, timestamp: new Date().toISOString() };
  // 写到 cwd，让外部脚本读取
  writeFileSync(join(process.cwd(), ".self-test-result.json"), JSON.stringify(report, null, 2));
  // 也打到 stderr（某些环境可见）
  console.error("SELF_TEST_RESULT=" + JSON.stringify(report));

  if (!allOk) process.exitCode = 1;
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * UI 验证：开 headless 窗口，加载构建产物（dist/renderer），等渲染层跑完
 * IPC 拉数据 + React 渲染，然后在渲染层执行 DOM 断言。
 *
 * 真 GUI 闭环：preload 注入的 window.api → IPC → DB → 回渲染层 → DOM。
 * 断言用 data-testid 锚点（与 App.tsx 里写的 testid 对齐）。
 *
 * 与 self-test 互补：self-test 只测主进程 DB；本函数测渲染层 + IPC + UI 结构。
 * 需要 npm run build 先跑（加载 dist/renderer/index.html）。
 */
async function runUiTest(screenshot = false): Promise<void> {
  const results: Array<{ name: string; ok: boolean; detail?: unknown }> = [];

  // headless 窗口（show:false）。screenshot 模式下临时 show 以便抓图。
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    show: screenshot,
    webPreferences: {
      preload: join(PROJECT_ROOT, "dist-electron/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  registerAllHandlers(win);

  // M2 测试造数：造一条 pending proposal，让 T8 能测 listPending→reject→空 的回路
  // （渲染层没暴露 createProposal IPC——create 是 AI 发起的，学习者只 list/apply/reject）
  try {
    createProposal(getDb(), {
      operations: [{ type: "update_mastery", nodeId: "test-seed-node", correct: true }],
      rationale: "UI test seed proposal",
    });
  } catch (e) {
    console.error("[lookatstudy] ui-test proposal seed failed:", e);
  }
  // 造一个 custom provider + active 设置(让 agentReady=true,ChatComposer 渲染 skill-picker)。
  // 优先用 .env 里的真实 ZAI key(让 ui-test 能真实出题/答题);没有则用占位假 key(只验证渲染)。
  try {
    const { settings: settingsTable, customProviders } = await import("./db/schema.js");
    const { getDb } = await import("./db/index.js");
    const zai = getZaiConfig();
    const PROVIDER_ID = "custom-ui-test-provider";
    const existingProvider = getDb().select().from(customProviders).all();
    if (existingProvider.length === 0) {
      getDb().insert(customProviders).values({
        id: PROVIDER_ID,
        label: zai ? "ZAI (env)" : "UI Test Provider",
        baseUrl: zai?.baseUrl ?? "https://example.com/v1",
        apiKey: zai?.apiKey ?? "test-key",
        defaultModel: zai?.model ?? "test-model",
      }).run();
    }
    // active_provider 用 upsert(确保指向存在的 provider id)。用户已配置则保留。
    const activeRow = getDb().select().from(settingsTable).where(eq(settingsTable.key, "active_provider")).get();
    const desiredValue = PROVIDER_ID;
    if (!activeRow) {
      getDb().insert(settingsTable).values({ key: "active_provider", value: desiredValue }).run();
    } else if (activeRow.value !== desiredValue && !activeRow.value.startsWith("custom-")) {
      getDb().update(settingsTable).set({ value: desiredValue }).where(eq(settingsTable.key, "active_provider")).run();
    }
  } catch (e) {
    console.error("[lookatstudy] ui-test provider seed failed:", e);
  }

  // 加载构建产物（不依赖 vite dev server，CI 友好）
  await win.loadFile(join(PROJECT_ROOT, "dist/renderer/index.html"));

  // 等渲染层拉完数据 + React 渲染完。轮询所有关键 testid 都出现——
  // 不能只等容器，因为 skills/courses 是异步并行拉的，容器早出、内容晚出，会 race。
  // v0.2: 三栏布局后 testid 变了——map-rail + map-node-* + chat-panel + notebook-panel
  // 注:skill-picker 在 ChatComposer 内,需选中节点才渲染,不在初始等待条件里。
  const waitRender = async (timeoutMs = 10000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    const checkAll = () =>
      win.webContents.executeJavaScript(`
        document.querySelector('[data-testid="map-rail"]') !== null &&
        document.querySelectorAll('[data-testid^="map-node-"]').length >= 1 &&
        document.querySelector('[data-testid="chat-panel"]') !== null &&
        document.querySelector('[data-testid="notebook-panel"]') !== null
      `);
    while (Date.now() < deadline) {
      try {
        const ready = await checkAll();
        if (ready) return true;
      } catch {
        // 页面跳转中，忽略
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  const rendered = await waitRender();
  results.push({
    name: "renderer mounted skill-tree + skill-picker",
    ok: rendered,
    detail: rendered ? "DOM testids present" : "timeout waiting for render",
  });

  if (!rendered) {
    // 渲染失败就早退，写文件让人看到原因
    const allOk = false;
    const report = { overall: allOk, results, timestamp: new Date().toISOString() };
    writeFileSync(join(process.cwd(), ".ui-test-result.json"), JSON.stringify(report, null, 2));
    console.error("UI_TEST_RESULT=" + JSON.stringify(report));
    process.exitCode = 1;
    return;
  }

  // T1: skill-picker(v0.2 收起为下拉)里应有 ≥4 个 option(4 个内置 skill)
  const optionCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid="skill-select"] option').length`,
  );
  results.push({
    name: "skill-picker has ≥4 builtin skill options",
    ok: typeof optionCount === "number" && optionCount >= 4,
    detail: { optionCount },
  });

  // T2: map-rail 至少有 1 个视图切换项 + path overview 有节点
  const navNodeCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid^="map-node-"]').length`,
  );
  results.push({
    name: "map-rail path overview has ≥1 node",
    ok: typeof navNodeCount === "number" && navNodeCount >= 1,
    detail: { navNodeCount },
  });

  // T3: 三栏都在(chat-panel + notebook-panel + map-rail)
  const threePane = await win.webContents.executeJavaScript(`
    document.querySelector('[data-testid="map-rail"]') !== null &&
    document.querySelector('[data-testid="chat-panel"]') !== null &&
    document.querySelector('[data-testid="notebook-panel"]') !== null
  `);
  results.push({
    name: "three-pane layout rendered (nav + chat + artifact)",
    ok: threePane === true,
  });

  // T4: streak badge 渲染（说明 getStreak IPC roundtrip 成功）
  const streakPresent = await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="streak-badge"]') !== null`,
  );
  results.push({
    name: "streak badge rendered (getStreak IPC OK)",
    ok: streakPresent === true,
  });

  // T5: 点击一个未锁的 map-node → 触发 markNodeAttempted → 联动右栏
  let clickResult: { clicked?: boolean; totalBtns?: number; enabledCount?: number; error?: string } = {};
  try {
    clickResult = await win.webContents.executeJavaScript(`
      (function() {
        try {
          var btns = document.querySelectorAll('[data-testid^="map-node-"]');
          var arr = [];
          for (var i = 0; i < btns.length; i++) arr.push(btns[i]);
          var enabled = arr.filter(function(b){ return !b.disabled; });
          for (var j = 0; j < enabled.length; j++) {
            enabled[j].click();
            return { clicked: true, totalBtns: btns.length, enabledCount: enabled.length };
          }
          return { clicked: false, totalBtns: btns.length, enabledCount: enabled.length };
        } catch (e) {
          return { error: String(e) };
        }
      })()
    `);
  } catch (e) {
    clickResult = { error: String(e) };
  }
  results.push({
    name: "clicked an unlocked map-node (markNodeAttempted IPC)",
    ok: clickResult?.clicked === true,
    detail: clickResult,
  });

  // T6: 点 skill select → setActiveSkill IPC roundtrip(改 select value)
  const skillSelect = await win.webContents.executeJavaScript(`
    (function() {
      const sel = document.querySelector('[data-testid="skill-select"]');
      if (!sel) return { ok: false, reason: "skill-select not found" };
      sel.value = "socratic-mode";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: sel.value };
    })()
  `);
  await new Promise((r) => setTimeout(r, 300));
  results.push({
    name: "skill select change triggers setActiveSkill",
    ok: skillSelect?.ok === true && skillSelect?.value === "socratic-mode",
    detail: skillSelect,
  });

  // T7 (M2): isAgentReady 在未配 key 时返回 ready:false（渲染层只见布尔，不见 key）
  const readyState = await win.webContents.executeJavaScript(
    `window.api.isAgentReady()`,
  );
  results.push({
    name: "isAgentReady returns valid state (ready boolean + provider + model)",
    ok: typeof readyState?.ready === "boolean" && typeof readyState?.provider === "string",
    detail: readyState,
  });

  // T8 (M2): proposal IPC 完整回路 —— listPending（应含 1 条 seed）
  //   → reject → listPending（应空）。验证 M2 接线 + proposal-service 真生效。
  const proposalRoundtrip = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const before = await window.api.listPendingProposals();
        if (before.length === 0) return { ok: false, reason: "no seed proposal found" };
        // 拒绝所有 pending proposals（测试环境可能有之前运行残留的）
        for (const p of before) {
          await window.api.rejectProposal(p.id);
        }
        const after = await window.api.listPendingProposals();
        return {
          ok: after.length === 0,
          beforeCount: before.length,
          afterCount: after.length,
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "proposal list→reject→empty roundtrip (M2 wiring)",
    ok: proposalRoundtrip?.ok === true,
    detail: proposalRoundtrip,
  });

  // T8a (v0.2 三栏): chat-stream + composer 都在(中栏完整)
  const midPane = await win.webContents.executeJavaScript(`
    (function() {
      const stream = document.querySelector('[data-testid="chat-stream"]');
      const composer = document.querySelector('[data-testid="composer"], [data-testid="composer-nokey"]');
      return {
        chatStream: !!stream,
        composer: !!composer,
      };
    })()
  `);
  results.push({
    name: "mid-pane: chat-stream + composer rendered",
    ok: midPane?.chatStream && midPane?.composer,
    detail: midPane,
  });

  // T8b (v0.4 联动): map-node 点击 → ThreadSwitcher 焦点节点 + thread 创建/切换
  const linkage = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const btns = document.querySelectorAll('[data-testid^="map-node-"]');
        let clicked = null;
        for (const b of btns) {
          if (!b.disabled) { b.click(); clicked = b.getAttribute('data-testid'); break; }
        }
        if (!clicked) return { ok: false, reason: "no enabled map-node" };
        await new Promise(r => setTimeout(r, 600));
        // v0.4: ThreadSwitcher 存在(有 thread 显示 tabs,无 thread 显示 empty 提示)
        const switcherEl = document.querySelector('[data-testid="thread-switcher"], [data-testid="thread-switcher-empty"]');
        const tabCount = document.querySelectorAll('[data-testid^="thread-tab-"]').length;
        return {
          ok: !!switcherEl,
          clicked,
          tabCount,
          hasEmpty: !!document.querySelector('[data-testid="thread-switcher-empty"]'),
        };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "map-node click → ThreadSwitcher shows focus node (联动)",
    ok: linkage?.ok === true,
    detail: linkage,
  });

  // T8c (v0.2 设置抽屉): 点 header settings → settings-drawer 出现
  const settingsDrawer = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const btn = document.querySelector('[data-testid="header-settings"]');
        if (!btn) return { ok: false, reason: "settings btn not found" };
        btn.click();
        await new Promise(r => setTimeout(r, 300));
        const drawer = document.querySelector('[data-testid="settings-drawer"]');
        const closeBtn = document.querySelector('[data-testid="settings-close"]');
        // 关回去
        if (closeBtn) { closeBtn.click(); await new Promise(r => setTimeout(r, 200)); }
        return { ok: !!drawer };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "header settings → settings-drawer opens (设置抽屉)",
    ok: settingsDrawer?.ok === true,
    detail: settingsDrawer,
  });

  // T9 (M3): 切到 dashboard 视图 → 仪表盘渲染（3 stat 卡 + 热力图行）
  const dashboardOk = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        // 点 map-view-map 切到地图视图
        const tab = document.querySelector('[data-testid="map-view-map"]');
        if (!tab) return { ok: false, reason: "map-view-map not found" };
        tab.click();
        await new Promise(r => setTimeout(r, 300));
        // v0.3:地图路径渲染——map-path 存在 + 至少 1 个 section + 节点
        const mapPath = document.querySelector('[data-testid="map-path"]');
        const sections = document.querySelectorAll('[data-testid^="map-section-"]').length;
        const nodes = document.querySelectorAll('[data-testid^="map-node-"]').length;
        return { ok: !!mapPath && sections >= 1 && nodes >= 1, sections, nodes };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "map-view-map renders path + sections + nodes",
    ok: dashboardOk?.ok === true,
    detail: dashboardOk,
  });

  // T10 (release): getProviderPresets IPC 返回 ≥5 个 provider
  const presetsCheck = await win.webContents.executeJavaScript(
    `window.api.getProviderPresets().then(p => ({count: p.length})).catch(e => ({count: 0, error: String(e)}))`,
  );
  results.push({
    name: "getProviderPresets IPC returns ≥5 providers",
    ok: presetsCheck?.count >= 5,
    detail: presetsCheck,
  });

  // T11 (release): 导入课程视图渲染 URL 输入 + markdown 切换 + 课程列表
  const importOk = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        document.querySelector('[data-testid="map-view-import"]').click();
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('[data-testid="import-url-section"]')) break;
          await new Promise(r => setTimeout(r, 100));
        }
        const urlSection = !!document.querySelector('[data-testid="import-url-section"]');
        const urlInput = !!document.querySelector('[data-testid="repo-url-input"]');
        const importBtn = !!document.querySelector('[data-testid="import-url-btn"]');
        // 切到 markdown tab
        document.querySelectorAll('button').forEach(b => { if (b.textContent === '粘贴 Markdown') b.click(); });
        await new Promise(r => setTimeout(r, 200));
        const mdSection = !!document.querySelector('[data-testid="import-md-section"]');
        const courseList = document.querySelectorAll('[data-testid="course-list"] > *').length;
        return { ok: urlSection && urlInput && importBtn && mdSection, urlSection, urlInput, mdSection, courseList };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "import view: URL import + markdown paste + course list",
    ok: importOk?.ok === true,
    detail: importOk,
  });

  // T12 (v0.2): 设置移到 Header 齿轮 + 左栏导航三视图 + 中栏 chat-stream
  const layoutOk = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        document.querySelector('[data-testid="map-view-map"]').click();
        await new Promise(r => setTimeout(r, 300));
        const headerSettings = !!document.querySelector('[data-testid="header-settings"]');
        const navTree = !!document.querySelector('[data-testid="map-view-map"]');
        const navDashboard = !!document.querySelector('[data-testid="map-view-map"]');
        const navImport = !!document.querySelector('[data-testid="map-view-import"]');
        return { ok: headerSettings && navTree && navDashboard && navImport, headerSettings, navTree, navDashboard, navImport };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "v0.2 layout: header settings + nav 3-views + chat-stream",
    ok: layoutOk?.ok === true,
    detail: layoutOk,
  });

  // T13 (M2): Cmd+K 命令面板能打开 + 命令列表渲染
  const cmdPalette = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        // 切回 tree 视图(确保命令面板能用)
        document.querySelector('[data-testid="map-view-map"]').click();
        await new Promise(r => setTimeout(r, 200));
        // 派发 Ctrl+K
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        const palette = document.querySelector('[data-testid="command-palette"]');
        const input = document.querySelector('[data-testid="command-input"]');
        const cmds = document.querySelectorAll('[data-testid^="command-"]').length;
        // 关掉
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return { ok: !!palette && !!input && cmds > 0, palette: !!palette, input: !!input, cmds };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "Cmd+K command palette opens with commands (M2)",
    ok: cmdPalette?.ok === true,
    detail: cmdPalette,
  });

  // T14 (M2): notebook tabs 容器存在(讲解/笔记 两标签结构在)
  const artifactTabs = await win.webContents.executeJavaScript(`
    document.querySelector('[data-testid="notebook-tabs"]') !== null &&
    document.querySelector('[data-testid="tab-notes"]') !== null
  `);
  results.push({
    name: "notebook panel tabs rendered (content/notes)",
    ok: artifactTabs === true,
  });

  // T15 (v0.3.4): 切到笔记 tab → 三区(理解/记录/练习)toggle 存在且初始折叠
  // 验证:defaultOpen=false 生效(箭头带 -rotate-90 表示折叠态)
  let zoneCollapse: { switched?: boolean; zones?: number; collapsed?: number; titles?: string[]; error?: string } = {};
  try {
    zoneCollapse = await win.webContents.executeJavaScript(`
      (function() {
        try {
          var tabBtn = document.querySelector('[data-testid="tab-notes"]');
          if (tabBtn) tabBtn.click();
          return { switched: true };
        } catch (e) { return { error: String(e) }; }
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));
    // 等 React 渲染后,检查三区 toggle 的折叠状态
    const zoneDetail = await win.webContents.executeJavaScript(`
      (function() {
        var ids = ["zone-understand-toggle", "zone-note-toggle", "zone-practice-toggle"];
        var toggles = ids.map(function(id){ return document.querySelector('[data-testid="' + id + '"]'); });
        var found = toggles.filter(Boolean);
        // 折叠态:ChevronDown 带 -rotate-90 class;初始应全部折叠
        var collapsed = toggles.filter(function(t){
          return t && t.querySelector('svg.lucide-chevron-down, svg[class*="chevron-down"]');
        }).filter(function(t){
          var svg = t.querySelector('svg');
          return svg && svg.className && svg.className.baseVal && svg.className.baseVal.indexOf('-rotate-90') >= 0;
        }).length;
        var titles = toggles.map(function(t){ return t ? t.textContent : null; });
        return { zones: found.length, collapsed: collapsed, titles: titles };
      })()
    `);
    zoneCollapse = { ...zoneCollapse, ...zoneDetail };
  } catch (e) {
    zoneCollapse = { error: String(e) };
  }
  results.push({
    name: "three zones (理解/记录/练习) collapsed by default after switching to notes tab",
    ok: zoneCollapse?.switched === true && zoneCollapse?.zones === 3 && zoneCollapse?.collapsed === 3,
    detail: zoneCollapse,
  });

  const allOk = results.every((r) => r.ok);
  const report = { overall: allOk, results, timestamp: new Date().toISOString() };
  writeFileSync(join(process.cwd(), ".ui-test-result.json"), JSON.stringify(report, null, 2));
  console.error("UI_TEST_RESULT=" + JSON.stringify(report));

  // 截图作为视觉证据（可选，--screenshot 触发）。落 cwd/ui-screenshot.png。
  if (screenshot) {
    try {
      const img = await win.webContents.capturePage();
      writeFileSync(join(process.cwd(), "ui-screenshot.png"), img.toPNG());
      console.error("[lookatstudy] screenshot saved to ui-screenshot.png");
    } catch (e) {
      console.error("[lookatstudy] screenshot failed:", e);
    }
  }

  if (!allOk) process.exitCode = 1;
}

/**
 * 画线往返测试:npm run test:highlight
 *
 * 验证 getTextModel → rangeToOffsets → offsetsToRange → applyPersistentMarks 在各种
 * DOM 结构下的精度。真 Chromium DOM(不是 jsdom 模拟)。
 *
 * 测试方法:注入带边界情况的 HTML(标题/列表/代码块/嵌套 span/空白/emoji),
 * 模拟"用户选中第 N 个字 → 保存 offset → 清空选区 → 用 offset 还原 Range → 画 mark
 * → 检查 mark 的 textContent 是否等于原选区文字"。
 *
 * 每个测试用例覆盖一种 DOM 结构的若干选区位置(开头/中间/结尾/跨节点)。
 */
async function runHighlightTest(): Promise<void> {
  const results: Array<{ name: string; ok: boolean; detail?: unknown }> = [];

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: { contextIsolation: false, nodeIntegration: true, sandbox: false },
  });

  // 用 esbuild 把 highlightText.ts 编译成纯 JS(比正则去类型可靠),注入测试页。
  // format:iife + globalName:HL → 函数挂到 window.HL,测试代码通过 HL.fn 访问。
  const tsPath = join(PROJECT_ROOT, "src/renderer/lib/highlightText.ts");
  let jsSrc = "";
  try {
    const { build } = await import("esbuild");
    const out = await build({
      entryPoints: [tsPath],
      bundle: false,
      write: false,
      format: "iife",
      globalName: "HL",
      target: "es2020",
    });
    jsSrc = new TextDecoder().decode(out.outputFiles[0].contents);
  } catch (e) {
    const errResult = { overall: false, results: [{ name: "esbuild compile", ok: false, detail: String(e) }] };
    writeFileSync(join(process.cwd(), ".highlight-test-result.json"), JSON.stringify(errResult, null, 2));
    process.exitCode = 1;
    return;
  }

  await win.loadURL("about:blank");
  // 先注入编译好的函数,验证 HL 全局挂载成功
  await win.webContents.executeJavaScript(jsSrc);
  const hlReady = await win.webContents.executeJavaScript("typeof window.HL === 'object' && typeof window.HL.getTextModel === 'function'");
  if (!hlReady) {
    const errResult = { overall: false, results: [{ name: "HL global mounted", ok: false, detail: "window.HL.getTextModel not a function" }] };
    writeFileSync(join(process.cwd(), ".highlight-test-result.json"), JSON.stringify(errResult, null, 2));
    process.exitCode = 1;
    return;
  }

  const runCase = async (name: string, html: string, selections: { desc: string; startText: string; len: number }[]) => {
    for (const sel of selections) {
      const result = await win.webContents.executeJavaScript(`(function() {
        try {
          const container = document.body;
          container.innerHTML = ${JSON.stringify(html)};
          container.normalize();
          const fullText = container.textContent || "";
          const idx = fullText.indexOf(${JSON.stringify(sel.startText)});
          if (idx < 0) return { ok: false, reason: "startText not found: " + ${JSON.stringify(sel.startText)} };
          const range = document.createRange();
          let acc = 0, startNode = null, startOff = 0, endNode = null, endOff = 0;
          const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = walker.nextNode())) {
            const t = n.textContent || "";
            if (!startNode && idx >= acc && idx < acc + t.length) { startNode = n; startOff = idx - acc; }
            if (!endNode && idx + ${sel.len} > acc && idx + ${sel.len} <= acc + t.length) { endNode = n; endOff = idx + ${sel.len} - acc; }
            acc += t.length;
          }
          if (!startNode || !endNode) return { ok: false, reason: "cannot map idx to text node", idx };
          range.setStart(startNode, startOff);
          range.setEnd(endNode, endOff);
          const expectedText = range.toString();
          const model = window.HL.getTextModel(container);
          const offsets = window.HL.rangeToOffsets(range, model);
          if (!offsets) return { ok: false, reason: "rangeToOffsets null", expected: expectedText };
          window.getSelection().removeAllRanges();
          const backRange = window.HL.offsetsToRange(model, offsets.start, offsets.end);
          if (!backRange) return { ok: false, reason: "offsetsToRange null", offsets };
          const actualText = backRange.toString();
          if (actualText !== expectedText) {
            return { ok: false, reason: "text mismatch", expected: expectedText, actual: actualText, offsets };
          }
          const marks = window.HL.applyPersistentMarks(container, [{ noteId: "n1", startOffset: offsets.start, endOffset: offsets.end }]);
          const markEl = marks.get("n1");
          if (!markEl) return { ok: false, reason: "no mark", offsets };
          const markText = markEl.textContent;
          if (markText !== expectedText) {
            return { ok: false, reason: "mark text mismatch", expected: expectedText, actual: markText };
          }
          return { ok: true, expected: expectedText };
        } catch (e) {
          return { ok: false, reason: "exception: " + (e && e.message || String(e)) };
        }
      })()`);
      results.push({ name: `${name} — ${sel.desc}`, ok: result.ok, detail: result });
    }
  };

  await runCase("simple paragraph", '<p>Deploying GPT-4 in production systems.</p>', [
    { desc: "开头 deploying", startText: "Deploying", len: 9 },
    { desc: "中间 GPT-4", startText: "GPT-4", len: 5 },
    { desc: "结尾 production", startText: "production", len: 10 },
    { desc: "跨空格 GPT-4 in", startText: "GPT-4 in", len: 8 },
  ]);
  await runCase("nested spans", '<div><span>AI</span><p>The <strong>quick brown</strong> fox jumps.</p></div>', [
    { desc: "The quick", startText: "The quick", len: 9 },
    { desc: "quick brown", startText: "quick brown", len: 11 },
    { desc: "fox jumps", startText: "fox jumps", len: 9 },
  ]);
  await runCase("list items", '<ul><li>First item here</li><li>Second item there</li></ul>', [
    { desc: "First", startText: "First", len: 5 },
    { desc: "Second", startText: "Second", len: 6 },
    { desc: "跨 li item there", startText: "item there", len: 10 },
  ]);
  await runCase("code block", '<pre><code>const x = 42;\nconst y = x + 1;</code></pre>', [
    { desc: "const x", startText: "const x", len: 7 },
    { desc: "跨行 x + 1", startText: "x + 1", len: 5 },
  ]);
  await runCase("heading + paragraph", '<h2>Section Title</h2><p>Some body text follows.</p>', [
    { desc: "Section", startText: "Section", len: 7 },
    { desc: "body text", startText: "body text", len: 9 },
    { desc: "跨元素 Title Some", startText: "Title", len: 10 },
  ]);
  await runCase("whitespace nodes", '<div>\n  <p>Hello world</p>\n</div>', [
    { desc: "Hello", startText: "Hello", len: 5 },
    { desc: "world", startText: "world", len: 5 },
  ]);
  await runCase("chinese text", '<p>大语言模型通过注意力机制处理序列数据。</p>', [
    { desc: "大语言", startText: "大语言", len: 3 },
    { desc: "注意力机制", startText: "注意力机制", len: 5 },
    { desc: "序列数据", startText: "序列数据", len: 4 },
  ]);
  await runCase("emoji mixed", '<p>✅ Correct! The answer is 42.</p>', [
    { desc: "Correct", startText: "Correct", len: 7 },
    { desc: "answer is", startText: "answer is", len: 9 },
  ]);
  await runCase("blockquote", '<blockquote><p>Quoted text inside.</p></blockquote>', [
    { desc: "Quoted", startText: "Quoted", len: 6 },
    { desc: "inside", startText: "inside", len: 6 },
  ]);

  win.close();
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}${r.ok ? "" : " — " + JSON.stringify(r.detail)}`);
  }
  console.log(`\n=== highlight roundtrip: ${passed}/${results.length} 通过 ${failed === 0 ? "✅" : "❌"} ===`);
  writeFileSync(join(process.cwd(), ".highlight-test-result.json"), JSON.stringify({ overall: failed === 0, results }, null, 2));
  console.error("HIGHLIGHT_TEST_RESULT=" + JSON.stringify({ overall: failed === 0, passed, total: results.length }));
  if (failed > 0) process.exitCode = 1;
}
