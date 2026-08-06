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
  const waitRender = async (timeoutMs = 10000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    const checkAll = () =>
      win.webContents.executeJavaScript(`
        document.querySelector('[data-testid="skill-tree"]') !== null &&
        document.querySelector('[data-testid="skill-picker"]') !== null &&
        document.querySelectorAll('[data-testid^="skill-pill-"]').length >= 4 &&
        document.querySelectorAll('[data-testid^="section-unit-"]').length >= 1 &&
        document.querySelectorAll('[data-testid^="lesson-bubble-"]').length >= 1 &&
        document.querySelector('[data-testid="chat-panel"]') !== null &&
        document.querySelector('[data-testid="divider"]') !== null
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

  // T1: skill-picker 里有 ≥4 个 skill pill（4 个内置）
  const pillCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid^="skill-pill-"]').length`,
  );
  results.push({
    name: "skill-picker shows ≥4 builtin skill pills",
    ok: typeof pillCount === "number" && pillCount >= 4,
    detail: { pillCount },
  });

  // T2: 至少一个 section-unit 存在（技能树结构）
  const sectionCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid^="section-unit-"]').length`,
  );
  results.push({
    name: "skill-tree has ≥1 section unit",
    ok: typeof sectionCount === "number" && sectionCount >= 1,
    detail: { sectionCount },
  });

  // T3: 至少一个 lesson bubble 存在
  const bubbleCount = await win.webContents.executeJavaScript(
    `document.querySelectorAll('[data-testid^="lesson-bubble-"]').length`,
  );
  results.push({
    name: "skill-tree has ≥1 lesson bubble",
    ok: typeof bubbleCount === "number" && bubbleCount >= 1,
    detail: { bubbleCount },
  });

  // T4: streak badge 渲染（说明 getStreak IPC roundtrip 成功）
  const streakPresent = await win.webContents.executeJavaScript(
    `document.querySelector('[data-testid="streak-badge"]') !== null`,
  );
  results.push({
    name: "streak badge rendered (getStreak IPC OK)",
    ok: streakPresent === true,
  });

  // T5: 点击一个未锁的 lesson bubble → 触发 markNodeAttempted → progress 更新
  // 找第一个 enabled 的 bubble 点击
  let clickResult: { clicked?: boolean; totalBtns?: number; enabledCount?: number; error?: string } = {};
  try {
    clickResult = await win.webContents.executeJavaScript(`
      (function() {
        try {
          var lis = document.querySelectorAll('[data-testid^="lesson-bubble-"]');
          var btns = [];
          for (var i = 0; i < lis.length; i++) {
            var b = lis[i].querySelector('button');
            if (b) btns.push(b);
          }
          var enabled = btns.filter(function(b){ return !b.disabled; });
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
    name: "clicked an unlocked lesson bubble (markNodeAttempted IPC)",
    ok: clickResult?.clicked === true,
    detail: clickResult,
  });

  // T6: 点 skill pill → setActiveSkill IPC roundtrip
  const skillClick = await win.webContents.executeJavaScript(`
    (function() {
      const pill = document.querySelector('[data-testid="skill-pill-socratic-mode"]');
      if (!pill) return { ok: false, reason: "socratic pill not found" };
      pill.click();
      return { ok: true };
    })()
  `);
  // 给 IPC 一点时间
  await new Promise((r) => setTimeout(r, 300));
  const activeSkillClass = await win.webContents.executeJavaScript(`
    (function() {
      const pill = document.querySelector('[data-testid="skill-pill-socratic-mode"]');
      return pill ? pill.className : null;
    })()
  `);
  results.push({
    name: "skill pill click activates socratic-mode (active styling applied)",
    ok:
      skillClick?.ok === true &&
      typeof activeSkillClass === "string" &&
      activeSkillClass.includes("brand") &&
      activeSkillClass.includes("font-semibold"),
    detail: { skillClick, activeClassHead: activeSkillClass?.slice(0, 60) },
  });

  // T7 (M2): isAgentReady 在未配 key 时返回 ready:false（渲染层只见布尔，不见 key）
  const readyState = await win.webContents.executeJavaScript(
    `window.api.isAgentReady()`,
  );
  results.push({
    name: "isAgentReady returns ready=false when no key configured",
    ok: readyState?.ready === false,
    detail: readyState,
  });

  // T8 (M2): proposal IPC 完整回路 —— listPending（应含 1 条 seed）
  //   → reject → listPending（应空）。验证 M2 接线 + proposal-service 真生效。
  const proposalRoundtrip = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const before = await window.api.listPendingProposals();
        if (before.length === 0) return { ok: false, reason: "no seed proposal found" };
        const id = before[0].id;
        await window.api.rejectProposal(id);
        const after = await window.api.listPendingProposals();
        return {
          ok: after.length === 0,
          beforeCount: before.length,
          afterCount: after.length,
          rejectedStatus: before[0].status,
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

  // T8a (双栏): chat-panel 存在 + config-guide 显示（无 key 时）
  const dualPane = await win.webContents.executeJavaScript(`
    (function() {
      const chat = document.querySelector('[data-testid="chat-panel"]');
      const divider = document.querySelector('[data-testid="divider"]');
      const configGuide = document.querySelector('[data-testid="config-guide"]');
      const configProvider = document.querySelector('[data-testid="config-provider"]');
      return {
        chatPanel: !!chat,
        divider: !!divider,
        configGuide: !!configGuide,
        configProvider: !!configProvider,
      };
    })()
  `);
  results.push({
    name: "dual-pane: chat-panel + divider + config-guide rendered",
    ok: dualPane?.chatPanel && dualPane?.divider && dualPane?.configGuide && dualPane?.configProvider,
    detail: dualPane,
  });

  // T8b (双栏联动): 点一个 lesson bubble → chat-panel 顶部显示该节点标题
  const linkage = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const btns = document.querySelectorAll('[data-testid^="lesson-bubble-"] button');
        let clicked = null;
        for (const b of btns) {
          if (!b.disabled) { b.click(); clicked = b.closest('[data-testid]').getAttribute('data-testid'); break; }
        }
        if (!clicked) return { ok: false, reason: "no enabled bubble" };
        await new Promise(r => setTimeout(r, 500));
        const nodeLabel = document.querySelector('[data-testid="chat-current-node"]');
        return { ok: !!nodeLabel && nodeLabel.textContent.includes('📍'), clicked, label: nodeLabel?.textContent };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "lesson click → chat-panel shows selected node (联动)",
    ok: linkage?.ok === true,
    detail: linkage,
  });

  // T8c (双栏折叠): 点折叠按钮 → chat-panel 消失，sidebar-collapsed 出现
  const collapse = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        const collapseBtn = document.querySelector('[data-testid="chat-collapse-btn"]');
        if (!collapseBtn) return { ok: false, reason: "collapse btn not found" };
        collapseBtn.click();
        await new Promise(r => setTimeout(r, 300));
        const collapsed = document.querySelector('[data-testid="sidebar-collapsed"]');
        const expandBtn = document.querySelector('[data-testid="chat-expand-btn"]');
        // 再展开回来（不影响后续测试）
        if (expandBtn) { expandBtn.click(); await new Promise(r => setTimeout(r, 300)); }
        return { ok: !!collapsed && !!expandBtn };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()
  `);
  results.push({
    name: "chat collapse → sidebar-collapsed + expand button (折叠)",
    ok: collapse?.ok === true,
    detail: collapse,
  });

  // T9 (M3): 切到 dashboard tab → 仪表盘渲染（3 stat 卡 + 热力图行）
  const dashboardOk = await win.webContents.executeJavaScript(`
    (async function() {
      try {
        // 点 dashboard tab
        const tab = document.querySelector('[data-testid="tab-dashboard"]');
        if (!tab) return { ok: false, reason: "dashboard tab not found" };
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
    name: "dashboard tab renders stat cards + heatmap (M3)",
    ok: dashboardOk?.ok === true,
    detail: dashboardOk,
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
