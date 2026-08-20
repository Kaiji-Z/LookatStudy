/**
 * v0.11 桌宠窗入口:透明置顶常驻窗只挂 PetCompanion,不进应用三栏。
 * 与主窗共用 index.css(形象动效/token)+ pet.css(透明底覆盖)。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./pet.css";
import { PetCompanion } from "./components/companion/PetCompanion.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PetCompanion />
  </StrictMode>,
);
