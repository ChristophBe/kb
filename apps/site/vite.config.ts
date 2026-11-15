import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the site under /knowcelium/ (christophbe.github.io/knowcelium); the Pages workflow sets SITE_BASE.
  base: process.env.SITE_BASE ?? "/knowcelium/",
  plugins: [react(), tailwindcss()],
  server: { port: 5174 },
});
