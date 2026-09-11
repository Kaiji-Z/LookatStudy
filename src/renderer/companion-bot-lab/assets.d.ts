/** 静态资产导入的模块声明(vite URL)。 */
declare module "*.png" {
  const src: string;
  export default src;
}
