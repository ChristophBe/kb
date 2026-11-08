import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // KB_WEB_DEV_PORT must match the dev redirect URI Dex allows (deploy/dex).
  server: { port: Number(process.env.KB_WEB_DEV_PORT ?? 5173) },
});
