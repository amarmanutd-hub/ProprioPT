import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ptApp = path.resolve(root, "../pt-app");
const out = path.resolve(root, "public/workout");

const build = spawnSync("npm", ["run", "build"], {
  cwd: ptApp,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, WORKOUT_BASE: "/workout/" },
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
console.log(`Workout copied → ${out}`);
