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

mkdirSync(outDir, { recursive: true });

for (const script of SCRIPTS) {
  const body = readFileSync(join(bodiesDir, script.body), "utf8").trim();
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
      sharedPreamble,
      "",
      "// ── end of generated shared helpers — automation-specific logic below ───",
      "",
      body,
    ].join("\n") + "\n";
  writeFileSync(join(outDir, script.out), output);
  console.log(`Wrote ${join(outDir, script.out)}`);
}
