import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");

const viteCmd = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite"
);

const proxy = spawn(process.execPath, [path.join(root, "proxy.mjs")], {
  stdio: "inherit",
  cwd: root,
});

const vite = spawn(viteCmd, [], {
  stdio: "inherit",
  cwd: root,
  shell: process.platform === "win32",
});

const shutdown = () => {
  if (!proxy.killed) proxy.kill("SIGTERM");
  if (!vite.killed) vite.kill("SIGTERM");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
