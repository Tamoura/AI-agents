/**
 * Builds self-contained HTML versions of the docs (learning path, playbook).
 * Usage: node scripts/build-docs-html.mjs
 * Output: docs/<name>.html — single file, no external assets, light/dark aware, printable.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DOCS = [
  {
    src: "docs/LEARNING-PATH.md",
    out: "docs/learning-path.html",
    title: "QDB Agentic AI — Zero-to-Hero Curriculum",
    subtitle: "Build · Architect · Secure · Govern · Deploy · Evaluate · Observe",
    badge: "Curriculum · updated July 2026",
  },
  {
    src: "docs/PRODUCTION-PLAYBOOK.md",
    out: "docs/production-playbook.html",
    title: "QDB Agentic AI — Production Playbook",
    subtitle: "Running agents as digital employees in a regulated bank",
    badge: "Playbook · updated July 2026",
  },
];

const slugCounts = new Map();
function slugify(text) {
  const base = text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9؀-ۿ\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  const n = (slugCounts.get(base) ?? 0) + 1;
  slugCounts.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

function render(doc) {
  slugCounts.clear();
  const md = readFileSync(join(ROOT, doc.src), "utf8");
  const headings = [];

  const renderer = new marked.Renderer();
  renderer.heading = ({ text, depth, tokens }) => {
    const inline = marked.Parser.parseInline(tokens);
    const id = slugify(text);
    if (depth === 1 || depth === 2 || depth === 3) {
      headings.push({ depth, text: text.replace(/[*_`]/g, ""), id });
    }
    return `<h${depth} id="${id}">${inline}<a class="anchor" href="#${id}" aria-label="link to section">#</a></h${depth}>\n`;
  };
  renderer.table = function (token) {
    const html = marked.Renderer.prototype.table.call(this, token);
    return `<div class="table-wrap">${html}</div>`;
  };

  const body = marked.parse(md, { renderer, gfm: true });

  const toc = headings
    .filter((h) => h.depth <= 2)
    .map(
      (h) =>
        `<li class="toc-d${h.depth}"><a href="#${h.id}">${h.text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")}</a></li>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${doc.title}</title>
<style>
:root {
  --bg: #faf9f6; --panel: #ffffff; --ink: #1f2430; --muted: #5c6470;
  --accent: #7a1f2b; --accent-soft: #f3e2e4; --line: #e3e0da;
  --code-bg: #f1efe9; --mark: #8a6d1f; --link: #8f2d3c;
  --shadow: 0 1px 3px rgba(30,30,40,.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181d; --panel: #1d2026; --ink: #e8e6e1; --muted: #9aa0aa;
    --accent: #d98a94; --accent-soft: #3a2226; --line: #2e323a;
    --code-bg: #24272e; --mark: #d8b45a; --link: #e0949e;
    --shadow: 0 1px 3px rgba(0,0,0,.4);
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 1.5rem; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font: 16px/1.65 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
}
.layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); max-width: 1280px; margin: 0 auto; }
nav {
  position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto;
  padding: 2rem 1.25rem 3rem; border-right: 1px solid var(--line);
  font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: .82rem;
}
nav .nav-title { font-weight: 700; color: var(--accent); letter-spacing: .04em; text-transform: uppercase; font-size: .72rem; margin-bottom: 1rem; }
nav ul { list-style: none; margin: 0; padding: 0; }
nav li { margin: 0; }
nav a { display: block; padding: .28rem .5rem; color: var(--muted); text-decoration: none; border-radius: 6px; border-left: 2px solid transparent; }
nav a:hover { color: var(--ink); background: var(--accent-soft); }
li.toc-d1 { margin-top: .9rem; }
li.toc-d1 > a { font-weight: 700; color: var(--ink); }
li.toc-d2 > a { padding-left: 1.1rem; border-left: 2px solid var(--line); border-radius: 0 6px 6px 0; margin-left: .5rem; }
main { padding: 2.5rem 3rem 6rem; max-width: 860px; }
header.doc-header { margin-bottom: 2.5rem; padding-bottom: 1.75rem; border-bottom: 3px double var(--accent); }
.badge {
  display: inline-block; font-family: -apple-system, "Segoe UI", sans-serif; font-size: .7rem;
  letter-spacing: .08em; text-transform: uppercase; color: var(--accent);
  border: 1px solid var(--accent); border-radius: 999px; padding: .2rem .7rem; margin-bottom: 1rem;
}
header.doc-header h1 { font-size: 2.1rem; line-height: 1.2; margin: 0 0 .5rem; }
header.doc-header p { color: var(--muted); font-style: italic; margin: 0; }
h1, h2, h3, h4 { line-height: 1.25; scroll-margin-top: 1.5rem; position: relative; }
main > h1 { font-size: 1.7rem; margin-top: 3.5rem; color: var(--accent); border-bottom: 1px solid var(--line); padding-bottom: .4rem; }
h2 { font-size: 1.35rem; margin-top: 2.75rem; }
h3 { font-size: 1.08rem; margin-top: 2rem; font-family: -apple-system, "Segoe UI", sans-serif; }
a.anchor { opacity: 0; margin-left: .4rem; text-decoration: none; color: var(--muted); font-size: .8em; }
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor, h4:hover .anchor { opacity: 1; }
a { color: var(--link); }
p, li { max-width: 72ch; }
strong { color: var(--ink); }
code {
  font-family: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
  font-size: .84em; background: var(--code-bg); padding: .12em .38em; border-radius: 4px;
}
pre { background: var(--code-bg); border: 1px solid var(--line); border-radius: 8px; padding: 1rem; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 1.25rem 0; padding: .1rem 1.25rem; border-left: 3px solid var(--accent); background: var(--panel); color: var(--muted); border-radius: 0 8px 8px 0; }
.table-wrap { overflow-x: auto; margin: 1.25rem 0; border: 1px solid var(--line); border-radius: 8px; box-shadow: var(--shadow); }
table { border-collapse: collapse; width: 100%; font-family: -apple-system, "Segoe UI", sans-serif; font-size: .85rem; background: var(--panel); }
th { text-align: left; background: var(--accent-soft); color: var(--ink); font-weight: 700; }
th, td { padding: .55rem .8rem; border-bottom: 1px solid var(--line); vertical-align: top; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: color-mix(in srgb, var(--accent-soft) 40%, transparent); }
hr { border: none; border-top: 1px solid var(--line); margin: 3rem 0; }
em { color: inherit; }
::selection { background: var(--accent-soft); }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; }
  nav { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--line); }
  main { padding: 1.5rem 1.25rem 4rem; }
}
@media print {
  nav { display: none; }
  .layout { display: block; }
  main { max-width: none; padding: 0; }
  body { font-size: 11pt; background: #fff; color: #000; }
  a.anchor { display: none; }
  h1, h2 { break-after: avoid; }
  .table-wrap { border: none; box-shadow: none; }
}
</style>
</head>
<body>
<div class="layout">
<nav aria-label="Table of contents">
  <div class="nav-title">Contents</div>
  <ul>
${toc}
  </ul>
</nav>
<main>
<header class="doc-header">
  <span class="badge">${doc.badge}</span>
  <h1>${doc.title}</h1>
  <p>${doc.subtitle}</p>
</header>
${body}
</main>
</div>
</body>
</html>
`;
}

for (const doc of DOCS) {
  const html = render(doc);
  writeFileSync(join(ROOT, doc.out), html);
  console.log(`built ${doc.out} (${(html.length / 1024).toFixed(0)} KB)`);
}
