/**
 * deploy.mjs — copies built plugin files into your Obsidian vault.
 *
 * Set OBSIDIAN_VAULT to your vault path, either here or as an env variable:
 *   OBSIDIAN_VAULT="/path/to/vault" npm run deploy
 */

import fs from "fs";
import path from "path";

// ── Configure your vault path here ────────────────────────────────────────
const VAULT_PATH = process.env.OBSIDIAN_VAULT || "/Users/egstad/Documents/Obsidian/garden";
// ──────────────────────────────────────────────────────────────────────────

if (!VAULT_PATH) {
  console.error(
    "\nError: vault path not set.\n" +
    "Either edit deploy.mjs and set VAULT_PATH, or run:\n" +
    '  OBSIDIAN_VAULT="/path/to/your/vault" npm run deploy\n'
  );
  process.exit(1);
}

const PLUGIN_ID = "voice-notes-ai";
const DEST = path.join(VAULT_PATH, ".obsidian", "plugins", PLUGIN_ID);
const FILES = ["main.js", "manifest.json", "styles.css"];

// Create plugin folder if it doesn't exist
fs.mkdirSync(DEST, { recursive: true });

let ok = true;
for (const file of FILES) {
  if (!fs.existsSync(file)) {
    console.error(`  ✗ ${file} not found — run 'npm run build' first`);
    ok = false;
    continue;
  }
  fs.copyFileSync(file, path.join(DEST, file));
  console.log(`  ✓ ${file}`);
}

if (ok) {
  console.log(`\nDeployed to: ${DEST}`);
  console.log("Reload Obsidian (or toggle the plugin off/on) to apply.\n");
}
