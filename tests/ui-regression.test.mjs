// Run: node --test tests/ui-regression.test.mjs
// App-only smoke tests; no API, credentials, or live mailbox needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as kumo from "@cloudflare/kumo";
const { Button } = kumo;

const root = resolve(import.meta.dirname, "..");
const source = (file) => readFileSync(join(root, "app", file), "utf8");
const bundle = await build({
  entryPoints: [join(root, "app/components/ComposeFields.tsx")],
  bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic",
});
const module = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(
  (id) => id === "@cloudflare/kumo" ? kumo : createRequire(import.meta.url)(id), module, module.exports,
);
const ComposeFields = module.exports.default;
const props = {
  to: "Long recipient <recipient@example.com>", cc: "", bcc: "",
  subject: "Re: A long subject that should use the whole available width",
  showCcBcc: false,
  setTo() {}, setCc() {}, setBcc() {}, setSubject() {}, setShowCcBcc() {},
};
const fields = renderToStaticMarkup(React.createElement(ComposeFields, props));

test("both composers share full-width, labeled fields with expandable copies", () => {
  for (const file of ["ComposeEmail.tsx", "ComposePanel.tsx"])
    assert.match(source(`components/${file}`), /<ComposeFields/);
  assert.equal((fields.match(/<input /g) || []).length, 4);
  assert.equal((fields.match(/w-full min-w-0/g) || []).length, 4);
  assert.match(fields, /aria-labelledby=/);
  assert.match(fields, /aria-expanded="false"/);
  assert.match(fields, /hidden=""/);
  const expanded = renderToStaticMarkup(React.createElement(ComposeFields, { ...props, showCcBcc: true }));
  assert.match(expanded, /aria-expanded="true"/);
  assert.doesNotMatch(expanded, /hidden=""/);
});

test("assistant entry is unique and settings retain separate pages and scope guards", () => {
  assert.equal((source("components/Header.tsx").match(/aria-controls="ai-assistant-panel"/g) || []).length, 2); // trigger + focus selector
  assert.doesNotMatch(source("components/ComposePanel.tsx"), /toggleAgentPanel|AI assistant/);
  assert.match(source("components/ComposePanel.tsx"), /Write with AI/);
  assert.match(source("routes.ts"), /settings\/:section\?/);
  const settings = source("routes/settings.tsx");
  assert.match(settings, /MailboxSettings key=\{mailboxId\}/);
  for (const section of ["api-keys", "automations", "groups", "memory"])
    assert.ok(settings.includes(`id: "${section}"`));
  const hierarchy = source("components/HierarchySettings.tsx");
  assert.match(hierarchy, /useBeforeUnload/);
  assert.match(hierarchy, /useBlocker/);
  assert.match(hierarchy, /descendants\.has\(g\.id\)/);
});

test("folder creation targets a concrete mailbox and reports failures", () => {
  const sidebar = source("components/Sidebar.tsx");
  assert.match(sidebar, /useMailbox\(mailboxId === "all" \? undefined : mailboxId\)/);
  assert.match(sidebar, /const folderMailboxId = mailboxId === "all" \? undefined : currentMailbox\?\.id;/);
  assert.match(sidebar, /await createFolderMutation\.mutateAsync/);
  assert.match(sidebar, /title: "Failed to create folder"/);
  assert.match(sidebar, /maxLength=\{64\}/);
  assert.match(sidebar, /loading=\{createFolderMutation\.isPending\}/);
  assert.match(sidebar, /\{folderMailboxId && customFolders\.length/);
  const api = source("services/api.ts");
  assert.match(api, /mailboxes\/\$\{encodeURIComponent\(mailboxId\)\}\/folders/);
});

test("memory reload locks edits, saves and scope navigation without dropping edits on failure", () => {
  const hierarchy = source("components/HierarchySettings.tsx");
  assert.match(hierarchy, /disabled=\{mutation\.isPending \|\| reloading\}/);
  assert.match(hierarchy, /mutation\.isPending \|\|\s+reloading \|\|\s+!draft/);
  assert.match(hierarchy, /<fieldset disabled=\{saving\}/);
  assert.match(hierarchy, /setReloading\(true\);\s+onSaving\(true\);/);
  assert.match(hierarchy, /if \(result\.isSuccess\) \{\s+setDraft\(null\);\s+onDirty\(false\);/);
  assert.match(hierarchy, /finally \{\s+setReloading\(false\);\s+onSaving\(false\);/);
  assert.match(hierarchy, /key=\{`\$\{scope\.type\}:\$\{scope\.id\}`\}/);
  for (const scope of ["all", "group", "mailboxes"])
    assert.ok(hierarchy.includes(`<option value="${scope}">`));
});

test("mailbox rule action limit also applies to reply actions", () => {
  const body = source("routes/settings.tsx").match(/const canAddAction = \(type: AutomationAction\["type"\]\) => \{([\s\S]*?)\n\t\};/)[1];
  const canAdd = (draftActions, type) => new Function("draftActions", "type", body)(draftActions, type);
  for (const type of ["file", "mark_read", "star", "auto_reply", "ai_reply"])
    assert.equal(canAdd(Array.from({ length: 20 }, () => ({ type: "star" })), type), false);
  assert.equal(canAdd([{ type: "star" }], "ai_reply"), true);
  assert.equal(canAdd([{ type: "auto_reply" }], "ai_reply"), false);
});

test("instruction textareas retain readable placeholders and visible keyboard focus", () => {
  for (const file of ["components/ComposePanel.tsx", "routes/settings.tsx"])
    assert.match(source(file), /placeholder:text-white\/60 resize-y focus:outline-none focus:ring-2 focus:ring-white\/60/);
  const settings = source("routes/settings.tsx");
  assert.match(settings, /activeSection === "api-keys" && mailbox/);
  assert.match(settings, /<HierarchySettings/);
});

const compiler = await compile(source("index.css"), { base: join(root, "app"), onDependency() {} });
const scanner = new Scanner({ sources: [
  { base: join(root, "app"), pattern: "**/*.{tsx,ts}", negated: false },
  { base: join(root, "node_modules/@cloudflare/kumo/dist"), pattern: "**/*.js", negated: false },
] });
const css = compiler.build(scanner.scan());
test("compiled theme includes contrast override before important utility layer", () => {
  assert.match(css, /:is\(button, a\)\.bg-kumo-brand/);
  assert.match(css, /color: #111111 !important/);
  assert.ok(css.includes("!text-white"));
});

const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
test("browser: primary states contrast and narrow composer fields fill their pane", { skip: !existsSync(edge) }, () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-ui-"));
  try {
    const buttons = [false, true].map((disabled) => renderToStaticMarkup(React.createElement(Button, { variant: "primary", disabled }, "Send"))).join("");
    writeFileSync(join(dir, "fixture.html"), `<!doctype html><html class="dark" data-theme="dark"><style>${css}</style><body style="background:#111"><div id="fields" style="width:280px">${fields}</div>${buttons}<script>
      const checks = [...document.querySelectorAll('button.bg-kumo-brand')].every(b => getComputedStyle(b).color === 'rgb(17, 17, 17)');
      const inputs = [...document.querySelectorAll('#fields input')].filter(i => i.offsetWidth);
      document.body.dataset.details = JSON.stringify({colors: [...document.querySelectorAll('button.bg-kumo-brand')].map(b => getComputedStyle(b).color), inputs: inputs.map(i => [i.offsetWidth, i.offsetHeight])});
      document.body.dataset.result = checks && inputs.every(i => i.offsetWidth === 280 && i.offsetHeight >= 36) ? 'pass' : 'fail';
    </script></body></html>`);
    const result = spawnSync(edge, ["--headless", "--disable-gpu", "--no-first-run", `--user-data-dir=${join(dir, "profile")}`, "--dump-dom", `file:///${join(dir, "fixture.html").replaceAll("\\", "/")}`], { encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    assert.ifError(result.error);
    assert.ok(result.stdout.includes('data-result="pass"'), result.stdout.match(/<body[^>]*>/)?.[0] || result.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
