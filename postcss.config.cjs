// CommonJS 格式：项目 package.json 没有 "type":"module"（Electron 主进程要 CJS），
// 所以 PostCSS 配置用 .cjs + module.exports，避免 Node 的 MODULE_TYPELESS_PACKAGE_JSON 警告。
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
