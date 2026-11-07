// Renders the page to static HTML after `vite build`, so it reads without JavaScript
// and search engines see the content; the client bundle then hydrates it.
import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("dist/", import.meta.url));
const ssr = fileURLToPath(new URL("dist-ssr/", import.meta.url));

const { render } = (await import(`${ssr}entry-server.js`)) as { render: () => string };
const template = await readFile(`${dist}index.html`, "utf8");
if (!template.includes("<!--app-->")) throw new Error("index.html has no <!--app--> placeholder");
await writeFile(`${dist}index.html`, template.replace("<!--app-->", render()));
await rm(ssr, { recursive: true });
