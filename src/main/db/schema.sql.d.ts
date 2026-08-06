// 让 TypeScript 识别 ?raw import（vite 专用）
declare module "*?raw" {
  const content: string;
  export default content;
}
