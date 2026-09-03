// Generates the paste-into-Airtable scripts in docs/airtable-automations/ from
// the tested TypeScript source in ./src/ plus each automation's own
// Airtable-specific "body" in ./bodies/. Airtable's Scripting sandbox has no
// import/require, so every generated file has to be one self-contained blob —
// this concatenates rather than bundles, since the shared surface is small
// enough that a real bundler would be overkill.
//
// Run with: npm run build:automations --workspace server

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "src");
const bodiesDir = join(here, "bodies");
const outDir = join(here, "..", "..", "docs", "airtable-automations");

// Order matters: each file's dependencies must appear before it (function
// declarations hoist, but the `const` lookup tables inside them don't — a
// function can be CALLED before its own textual position thanks to hoisting,
// but not before the module that initializes what it reads has run).
const PURE_MODULES = [
  "text.ts",
  "givebutterParsing.ts",
  "memberFields.ts",
  "planFields.ts",
  "transactionFields.ts",
  "selectChoices.ts",
  "restFields.ts",
  "retry.ts",
];

function transpileToPlainJs(tsSource: string): string {
  const { outputText } = ts.transpileModule(tsSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  return outputText
    .split("\n")
    // Our own inter-file imports (e.g. `import { toText } from "./text.js";`)
    // are meaningless once everything is concatenated into one scope.
    .filter((line) => !/^import .* from ["'].*["'];?$/.test(line.trim()))
    // TS interfaces/types are already erased by transpileModule; this just
    // drops the now-redundant `export` keyword off what's left.
    .map((line) => line.replace(/^export (?=(function|const)\b)/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const sharedPreamble = PURE_MODULES.map((filename) => {
  const source = readFileSync(join(srcDir, filename), "utf8");
  return `// ${filename}\n${transpileToPlainJs(source)}`;
}).join("\n\n");

const SCRIPTS = [
  { body: "sync-givebutter-plans.body.js", out: "sync-givebutter-plans.js" },
  { body: "sync-givebutter-contacts.body.js", out: "sync-givebutter-contacts.js" },
  { body: "sync-givebutter-transactions.body.js", out: "sync-givebutter-transactions.js" },
  { body: "sync-givebutter-webhook.body.js", out: "sync-givebutter-webhook.js" },
];

// Every body file marks the end of its own config block (API keys, tunable
// constants) with this exact line. Splitting on it lets the generated file put
// config at the very top — above the shared helpers — so opening a script in
// Airtable to paste in a real key doesn't mean scrolling past everything else
// first. See `sync-givebutter-plans.body.js` for where it's placed.
const CONFIG_MARKER = "// ═══ END CONFIG ═══";

function splitConfig(body: string): { config: string; rest: string } {
  const markerIndex = body.split("\n").findIndex((line) => line.trim() === CONFIG_MARKER);
  if (markerIndex === -1) {
    throw new Error(`Missing "${CONFIG_MARKER}" marker — every body file needs one after its config constants.`);
  }
  const lines = body.split("\n");
  return {
    config: lines.slice(0, markerIndex).join("\n").trim(),
    rest: lines.slice(markerIndex + 1).join("\n").trim(),
  };
}

mkdirSync(outDir, { recursive: true });

for (const script of SCRIPTS) {
  const body = readFileSync(join(bodiesDir, script.body), "utf8").trim();
  const { config, rest } = splitConfig(body);
  const output =
    [
      "// ═══════════════════════════════════════════════════════════════════════",
      "// GENERATED FILE — do not hand-edit.",
      "//",
      "// Source: server/airtable-automations/src/ (tested pure functions — see the",
      "// *.test.ts files there for the edge cases these handle) and",
      "// server/airtable-automations/bodies/ (this automation's own logic). Edit",
      "// those, then run `npm run build:automations --workspace server` and paste",
      "// the regenerated file into Airtable.",
      "// ═══════════════════════════════════════════════════════════════════════",
      "",
      config,
      "",
      "// ── shared helpers (generated — edit server/airtable-automations/src/) ──",
      "",
      sharedPreamble,
      "",
      "// ── end of generated shared helpers — automation-specific logic below ───",
      "",
      rest,
    ].join("\n") + "\n";
  writeFileSync(join(outDir, script.out), output);
  console.log(`Wrote ${join(outDir, script.out)}`);
}
