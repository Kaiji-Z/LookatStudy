# 构建笔记（踩坑记录）

记录开发过程中遇到的真实环境问题与决策，避免重复踩坑。

---

## 1. 为什么用 sql.js 而不是 better-sqlite3？

**初版选了 better-sqlite3**（drizzle 文档推荐，性能更好），但在 Windows + Node 24 环境下连环失败：

| 失败点 | 原因 |
|---|---|
| `prebuild-install` 下载二进制 | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 证书问题 |
| 回退到源码编译（node-gyp） | Python 3.14 移除了 `distutils`，gyp 报 `ModuleNotFoundError` |
| 指向 Python 3.10 后 | better-sqlite3 13.x 的 binding.gyp 写死 `ClangCL` 工具集，VS Build Tools 未安装该组件 |
| 降到 12.x | 仍走源码编译，同样卡在 MSBuild 工具集 |

**决策：换 sql.js（SQLite 编译成 WASM，纯 JS，零 native 依赖）。**

代价：内存数据库，需手动持久化（已在 `src/main/db/index.ts` 用防抖自动保存封装）。
收益：**永远绕开 native 编译地狱**——这对开源项目的贡献者和最终用户至关重要（clone 下来 `npm install` 就能跑）。

---

## 2. Electron 主进程 ESM/CJS 路径坑

**症状**：vite-plugin-electron 默认输出 ESM 格式 `.js` 文件，但：
- `import.meta.url` 在 vite 编译后变成非 `file:` scheme，`fileURLToPath` 报 `ERR_INVALID_URL_SCHEME`
- 项目根 `package.json` 的 `"type": "module"` 让 `.js` 被当 ESM 解析，但主进程用了 CJS 的 `require.resolve`

**错误信息**：
```
TypeError [ERR_INVALID_URL_SCHEME]: The URL must be of scheme file
    at fileURLToPath
Cannot find module 'D:\...\dist-electron\main\index.js'
```

**解决方案**（三步，缺一不可）：

1. **vite.config.ts**：给 electron 的 rollupOptions 显式指定 `output.format: "cjs"`
2. **package.json**：去掉根的 `"type": "module"`（让 `.js` 默认按 CJS 解析）
3. **源码**：主进程直接用全局 `__dirname`（CJS 天然注入），不再用 `fileURLToPath(import.meta.url)`

---

## 3. vite-plugin-electron 输出路径相对于 root

**症状**：vite.config.ts 设了 `root: "src/renderer"`，导致 electron 的 `outDir: "dist-electron/main"` 被解析成 `src/renderer/dist-electron/main`，与 `package.json` 声明的 `dist-electron/main/index.js` 不一致。

**错误信息**：
```
Cannot find module 'D:\...\dist-electron\main\index.js'
```

**解决**：electron 配置里的 `outDir` 必须用 `resolve(__dirname, "...")` 绝对路径，不能写相对路径。

---

## 4. Electron 在 headless 环境静默退出

**症状**：在 SSH/headless 终端跑 `electron .`，进程启动后 0 字节输出，似乎立即退出。

**排查方法**：
- 加 `--self-test` flag（见 `src/main/index.ts` 的 `runSelfTest`），让主进程把结果写到 `.self-test-result.json` 而不是依赖 stderr
- 用 `timeout 12 node node_modules/electron/cli.js . --self-test --no-sandbox 2>&1 | head -30` 前台捕获

**结论**：不是真的静默退出，是 GUI 应用的 stderr 在某些终端不刷新。用文件作中间介质最可靠。

---

## 5. streak freeze 触发条件 bug（已被测试抓到）

**初版实现**：`if (gap === 1 && freezeCount > 0)` 触发 freeze。

**问题**：`gap === 1` 意味着 `lastActiveDate === 昨天`，这本来就是连续打卡，应该直接 `+1`，根本不该走 freeze 分支。freeze 的真实语义是"漏了一天"——即 `gap === 2`（前天打的、昨天漏了、今天回来）。

**修复**：`scripts/verify-streak.mjs` 的 T4 测试抓到，改为 `gap === 2`。

**教训**：写完纯函数立刻写测试，不要等集成测试。日期逻辑尤其容易出错。
