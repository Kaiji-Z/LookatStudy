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
import { initDb, getDb } from "./db/index.js";
import { registerAllHandlers } from "./ipc/index.js";
import { ensureSeedCourse } from "./services/seed.js";
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

app.whenReady().then(async () => {
  try {
    await initDb();
    console.error("[lookatstudy] DB initialized");
    ensureSeedCourse();
    console.error("[lookatstudy] seed course ensured");
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

  // 加载构建产物（不依赖 vite dev server，CI 友好）
  await win.loadFile(join(PROJECT_ROOT, "dist/renderer/index.html"));

  // 等渲染层拉完数据 + React 渲染完。轮询所有关键 testid 都出现——
  // 不能只等容器，因为 skills/courses 是异步并行拉的，容器早出、内容晚出，会 race。
  // v0.2: 三栏布局后 testid 变了——nav-rail + skill-picker + nav-node-* + chat-panel + artifact-panel
  const waitRender = async (timeoutMs = 10000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    const checkAll = () =>
      win.webContents.executeJavaScript(`
        document.querySelector('[data-testid="nav-rail"]') !== null &&
        document.querySelector('[data-testid="skill-picker"]') !== null &&
        document.querySelectorAll('[data-testid^="nav-node-"]').length >= 1 &&
        document.querySelector('[data-testid="chat-panel"]') !== null &&
        document.querySelector('[data-testid="artifact-panel"]') !== null
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

  // T2: nav-rail 至少有 1 个视图切换项 + path overview 有节点
  const navNodeCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid^="nav-node-"]').length`,
  );
  results.push({
    name: "nav-rail path overview has ≥1 node",
    ok: typeof navNodeCount === "number" && navNodeCount >= 1,
    detail: { navNodeCount },
  });

  // T3: 三栏都在(chat-panel + artifact-panel + nav-rail)
  const threePane = await win.webContents.executeJavaScript(`
    document.querySelector('[data-testid="nav-rail"]') !== null &&
    document.querySelector('[data-testid="chat-panel"]') !== null &&
    document.querySelector('[data-testid="artifact-panel"]') !== null
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

  // T5: 点击一个未锁的 nav-node → 触发 markNodeAttempted → 联动右栏
  let clickResult: { clicked?: boolean; totalBtns?: number; enabledCount?: number; error?: string } = {};
  try {
    clickResult = await win.webContents.executeJavaScript(`
      (function() {
        try {
          var btns = document.querySelectorAll('[data-testid^="nav-node-"]');
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
    name: "clicked an unlocked nav-node (markNodeAttempted IPC)",
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

  // T8b (三栏联动): nav-node 点击 → chat-current-node 显示该节点
  const linkage = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const btns = document.querySelectorAll('[data-testid^="nav-node-"]');
        let clicked = null;
        for (const b of btns) {
          if (!b.disabled) { b.click(); clicked = b.getAttribute('data-testid'); break; }
        }
        if (!clicked) return { ok: false, reason: "no enabled nav-node" };
        await new Promise(r => setTimeout(r, 500));
        const nodeLabel = document.querySelector('[data-testid="chat-current-node"]');
        return { ok: !!nodeLabel && nodeLabel.textContent.includes('📍'), clicked, label: nodeLabel?.textContent };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "nav-node click → chat shows selected node (三栏联动)",
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
        // 点 nav-dashboard(v0.2 改名)
        const tab = document.querySelector('[data-testid="nav-dashboard"]');
        if (!tab) return { ok: false, reason: "nav-dashboard not found" };
        tab.click();
        // 等 dashboard 渲染
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('[data-testid="dashboard"]')) break;
          await new Promise(r => setTimeout(r, 100));
        }
        const dash = document.querySelector('[data-testid="dashboard"]');
        if (!dash) return { ok: false, reason: "dashboard not rendered after click" };
        const stats = document.querySelectorAll('[data-testid^="stat-"]').length;
        const heatRows = document.querySelectorAll('[data-testid="mastery-heatmap"] > *').length;
        return { ok: stats >= 3 && heatRows >= 1, stats, heatRows };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "nav-dashboard renders stat cards + heatmap",
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
        document.querySelector('[data-testid="nav-import"]').click();
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
        document.querySelector('[data-testid="nav-tree"]').click();
        await new Promise(r => setTimeout(r, 300));
        const headerSettings = !!document.querySelector('[data-testid="header-settings"]');
        const navTree = !!document.querySelector('[data-testid="nav-tree"]');
        const navDashboard = !!document.querySelector('[data-testid="nav-dashboard"]');
        const navImport = !!document.querySelector('[data-testid="nav-import"]');
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
        document.querySelector('[data-testid="nav-tree"]').click();
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

  // T14 (M2): artifact tabs 容器存在(即使无产物,标签栏结构在)
  const artifactTabs = await win.webContents.executeJavaScript(`
    document.querySelector('[data-testid="artifact-tabs"]') !== null &&
    document.querySelector('[data-testid="tab-artifact"]') !== null
  `);
  results.push({
    name: "artifact panel tabs rendered (content/artifact/review)",
    ok: artifactTabs === true,
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
