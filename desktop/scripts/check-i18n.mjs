#!/usr/bin/env node
// Verifies every locale JSON has exactly the same keys as en.json.
// Exit code 1 if any gaps found.
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const localesDir = resolve(__dirname, "../src/locales");

const langs = ["ru", "uk", "pl", "de", "es"];
const en = JSON.parse(readFileSync(`${localesDir}/en.json`, "utf8"));
const enKeys = new Set(Object.keys(en));

let ok = true;

for (const lang of langs) {
  const data = JSON.parse(readFileSync(`${localesDir}/${lang}.json`, "utf8"));
  const keys = new Set(Object.keys(data));

  const missing = [...enKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !enKeys.has(k));

  if (missing.length) {
    console.error(`\n❌  ${lang}.json — missing ${missing.length} key(s):`);
    missing.forEach((k) => console.error(`   - ${k}`));
    ok = false;
  }
  if (extra.length) {
    console.error(`\n⚠️   ${lang}.json — ${extra.length} extra key(s) not in en.json:`);
    extra.forEach((k) => console.error(`   + ${k}`));
    ok = false;
  }
  if (!missing.length && !extra.length) {
    console.log(`✅  ${lang}.json — ${keys.size} keys, all present`);
  }
}

if (!ok) process.exit(1);
