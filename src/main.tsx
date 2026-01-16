import React from "react";
import { createRoot } from "react-dom/client";
import App from "../App";
import "./styles.css";

const container = document.getElementById("root");

if (container) {
  // Prevent duplicate root creation during HMR
  if (!(window as any).__reactRoot) {
    (window as any).__reactRoot = createRoot(container);
  }
  (window as any).__reactRoot.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
