import { spawnSync } from "node:child_process";
import { cpSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ptApp = path.resolve(root, "../pt-app");
const out = path.resolve(root, "public/demo");

const build = spawnSync("npm", ["run", "build"], {
  cwd: ptApp,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DEMO_BASE: "/demo/" },
});

if (build.status !== 0) process.exit(build.status ?? 1);

const dist = path.resolve(ptApp, "dist");
if (!existsSync(dist)) {
  console.error("pt-app dist missing after build");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(path.dirname(out), { recursive: true });
cpSync(dist, out, { recursive: true });
console.log(`Demo copied → ${out}`);
