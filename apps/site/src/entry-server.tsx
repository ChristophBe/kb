import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { App } from "./App.tsx";

/** The page as static HTML, for prerender.ts. */
export function render() {
  return renderToString(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
