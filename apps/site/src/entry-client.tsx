import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);
// The build prerenders the page into #root (prerender.ts); the dev server serves it empty.
if (root.firstElementChild) hydrateRoot(root, app);
else createRoot(root).render(app);
