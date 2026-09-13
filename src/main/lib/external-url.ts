/**
 * 外链协议白名单(纯函数)——shell.openExternal 前的唯一闸门。
 *
 * 渲染层展示不可信课程内容(任意 GitHub 仓库/网页/EPUB),其中的链接可以是任意
 * scheme;Windows 协议处理器(ms-msdt:/search-ms:/smb: 等)历史上多次成为本地
 * RCE 链入口。只放行 http/https/mailto(2026-09-13 审计 P1 修复,Electron 官方
 * 安全清单同款要求)。主窗与桌宠窗的 setWindowOpenHandler / will-navigate 共用。
 */
const EXTERNAL_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function isAllowedExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_URL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
