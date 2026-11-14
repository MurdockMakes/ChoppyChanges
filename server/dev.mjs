import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverArgs = [
  ...(existsSync(resolve(root, ".env")) ? ["--env-file=.env"] : []),
  resolve(root, "server/index.mjs"),
];
const children = [
  spawn(process.execPath, serverArgs, { cwd: root, stdio: "inherit", env: { ...process.env, COACH_HOST: "127.0.0.1" } }),
  spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js")], { cwd: root, stdio: "inherit" }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", (code) => stop(code || 0));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
