import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the Pages workflow sets SITE_BASE.
  base: process.env.SITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
});
