import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ptApp = path.resolve(root, "../pt-app");
const viteBin = path.resolve(root, "node_modules/vite/bin/vite.js");
const ptViteBin = path.resolve(ptApp, "node_modules/vite/bin/vite.js");

function run(cwd, command, args) {
  return spawn(process.execPath, [command, ...args], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

const app = run(ptApp, ptViteBin, ["--host", "127.0.0.1", "--port", "5174", "--strictPort"]);
const site = run(root, viteBin, ["--host", "127.0.0.1", "--port", "5173", "--strictPort"]);

const stop = () => {
  app.kill("SIGTERM");
  site.kill("SIGTERM");
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

app.on("exit", (code) => {
  if (code) site.kill("SIGTERM");
});
site.on("exit", (code) => {
  if (code) app.kill("SIGTERM");
  process.exit(code ?? 0);
});
