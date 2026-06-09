#!/usr/bin/env node
/**
 * npx/npm wrapper for OpenLeads.
 *
 * OpenLeads is a Python tool. This thin shim lets Node users run it via
 * `npx openleads ...` or install it globally with `npm i -g openleads`.
 * On first run it ensures the Python package is installed (pip), then forwards
 * all arguments to `python -m openleads`, inheriting stdio so the interactive
 * chat works normally.
 */
"use strict";
const { spawnSync } = require("child_process");

function findPython() {
  for (const cmd of ["python3", "python"]) {
    const r = spawnSync(cmd, ["--version"], { stdio: "ignore" });
    if (r.status === 0) return cmd;
  }
  return null;
}

function hasPackage(py) {
  return spawnSync(py, ["-c", "import openleads"], { stdio: "ignore" }).status === 0;
}

function ensurePackage(py) {
  if (hasPackage(py)) return true;
  console.error("[openleads] First run: installing the Python package via pip…");
  const tries = [
    ["-m", "pip", "install", "--user", "openleads[chat]"],
    ["-m", "pip", "install", "openleads[chat]"],
  ];
  for (const args of tries) {
    const r = spawnSync(py, args, { stdio: "inherit" });
    if (r.status === 0 && hasPackage(py)) return true;
  }
  return false;
}

function main() {
  const py = findPython();
  if (!py) {
    console.error("[openleads] Python 3.8+ is required. Install it: https://www.python.org/downloads/");
    process.exit(1);
  }
  if (!ensurePackage(py)) {
    console.error("[openleads] Could not auto-install. Please run:\n  pip install 'openleads[chat]'");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const r = spawnSync(py, ["-m", "openleads", ...args], { stdio: "inherit" });
  process.exit(r.status === null ? 1 : r.status);
}

main();
