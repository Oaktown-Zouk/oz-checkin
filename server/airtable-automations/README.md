# Airtable automations — source

Tested TypeScript source for the Airtable Automations scripts that sync Givebutter
data into the base. The actual paste-into-Airtable output lives in
[`docs/airtable-automations/`](../../docs/airtable-automations/) — see that folder's
README for what each automation does and the schedule it runs on.

This is a separate folder from `src/` (the deployed server) on purpose: nothing here
runs as part of the Hono server or its build. It's only used at dev time to produce
the four generated scripts.

## Layout

- `src/*.ts` + `src/*.test.ts` — pure functions and their tests. No `base`, no
  `fetch`, no Airtable/Givebutter API calls — just data in, data out. This is where
  the actual edge-case density of these scripts lives (name-splitting heuristics,
  boolean/select-field coercion, gap-fill-vs-diff member update semantics, the
  Covers Member race-safety decision), and where it's actually testable.
- `bodies/*.body.js` — each automation's own imperative shell: table references,
  Givebutter/Airtable HTTP calls, the run sequence. Deliberately thin; not unit
  tested (there's no practical way to mock Airtable's Scripting SDK with real
  fidelity), verified instead by the `Sync Log` table in production.
- `build.ts` — concatenates `src/` (type-stripped) + a `bodies/*.body.js` into each
  generated file in `docs/airtable-automations/`. Plain concatenation, not a real
  bundler — the shared surface is small enough not to need one, and Airtable's
  sandbox couldn't load a bundle's module graph anyway.
- `tsconfig.json` — scoped to this folder; the main `server/tsconfig.json` only
  includes `src/` and never sees these files.

## Commands (run from `server/`)

```
npm test                        # runs these tests too, alongside the rest of server/
npm run typecheck:automations
npm run build:automations       # regenerates docs/airtable-automations/*.js
```

After `build:automations`, review the diff in `docs/airtable-automations/` and paste
the changed file(s) into the corresponding Airtable automation's script editor.
