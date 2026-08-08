import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { ToastProvider } from "./components/Toast.js";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
);
