import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

// Suppress the default Chromium context menu everywhere except editable fields
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement;
  const editable = target.closest("input, textarea, [contenteditable]");
  if (!editable) e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
