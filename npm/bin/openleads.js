#!/usr/bin/env node
/**
 * npx/npm wrapper for OpenLeads.
 *
 * OpenLeads is a Python tool. This shim lets Node users run it with
 * `npx openleads ...` or `npm i -g openleads`. On first run it creates a private
 * virtualenv (so it never touches your system Python, and works on Homebrew and
 * Debian/Ubuntu Pythons that refuse `pip install`), installs the matching
 * `openleads` version from PyPI into it, then forwards every argument to
 * `python -m openleads` with stdio inherited so the chat REPL works normally.
 *
 * Environment:
 *   OPENLEADS_PYTHON  use this Python instead of searching for one
 *   OPENLEADS_HOME    where the private venv lives (default ~/.openleads)
 */
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const VERSION = require("../package.json").version;
const WIN = process.platform === "win32";

function run(cmd, args, opts) {
  return spawnSync(cmd, args, Object.assign({ stdio: "ignore" }, opts || {}));
}

function findPython() {
  const candidates = process.env.OPENLEADS_PYTHON
    ? [process.env.OPENLEADS_PYTHON]
    : WIN ? ["py", "python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const r = run(cmd, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)"]);
    if (r.status === 0) return cmd;
  }
  return null;
}

function venvDir() {
  const home = process.env.OPENLEADS_HOME || path.join(os.homedir(), ".openleads");
  return path.join(home, "npm-venv");
}

function venvPython(dir) {
  return WIN ? path.join(dir, "Scripts", "python.exe") : path.join(dir, "bin", "python");
}

function installedVersion(py) {
  const r = run(py, ["-c", "import openleads; print(openleads.__version__)"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

function ensureInstalled() {
  const dir = venvDir();
  const py = venvPython(dir);
  if (fs.existsSync(py) && installedVersion(py) === VERSION) return py;

  const base = findPython();
  if (!base) {
    console.error("[openleads] Python 3.8+ is required: https://www.python.org/downloads/");
    process.exit(1);
  }
  if (!fs.existsSync(py)) {
    console.error(`[openleads] First run: creating a private environment in ${dir}`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const mk = run(base, ["-m", "venv", dir], { stdio: "inherit" });
    if (mk.status !== 0) {
      console.error("[openleads] Couldn't create a virtualenv. On Debian/Ubuntu: sudo apt install python3-venv");
      process.exit(1);
    }
  }
  console.error(`[openleads] Installing openleads ${VERSION} from PyPI…`);
  const pip = run(py, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check",
    `openleads[all]==${VERSION}`], { stdio: "inherit" });
  if (pip.status !== 0 || installedVersion(py) !== VERSION) {
    console.error(`[openleads] Install failed. You can install it yourself instead:\n` +
      `  pipx install 'openleads[all]'   or   pip install 'openleads[all]'`);
    process.exit(1);
  }
  return py;
}

function main() {
  const py = ensureInstalled();
  const r = spawnSync(py, ["-m", "openleads", ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status === null ? 1 : r.status);
}

main();
