// In-memory instrumentation: counts actual pi-tui helpers at extension call sites only.
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const modules = process.env.PI_NODE_MODULES ?? resolve(homedir(), '.pi/agent/npm/node_modules');
export const pi = await import(pathToFileURL(resolve(modules, '@earendil-works/pi-coding-agent/dist/index.js')));
pi.initTheme('dark', false);
export const tui = await import(pathToFileURL(resolve(modules, '@earendil-works/pi-tui/dist/index.js')));

export function load(name, { dependencies = {} } = {}) {
  const path = `extensions/${name}.ts`;
  const raw = readFileSync(resolve(root, path), 'utf8');
  const counts = { visibleWidth: 0, truncateToWidth: 0 };
  const deps = { ...pi, ...tui, ...dependencies };
  for (const key of Object.keys(counts)) deps[key] = (...args) => { counts[key]++; return tui[key](...args); };
  const source = stripTypeScriptTypes(raw, { mode: 'transform' })
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?/gm, '')
    .replace(/export default function\s+(\w+)/g, 'function $1')
    .replace(/export /g, '');
  const names = name === 'assistant-bubbles' ? 'assistantBubbles, Bubble, state, flatClones, installUser' : name === 'compact-tool-cards' ? 'CardLine, MarginBlock, RoundedFrame, boxed, compactToolCards, isStaticExport, toneOf, wrap' : name === 'compact-codemode-card' ? 'CardLine, wrapCodemodeRenderers' : 'wrapOtherRenderers';
  const scope = { ...deps, process, console, homedir, isAbsolute: (p) => p.startsWith('/'), relative: (a, b) => b.slice(a.length + 1), globalThis: {} };
  const exports = new Function(...Object.keys(scope), `${source}\n;return {${names}};`)(...Object.values(scope));
  return { ...exports, counts, reset: () => { for (const k of Object.keys(counts)) counts[k] = 0; } };
}
export const theme = { fg: (_token, text) => `\x1b[32m${text}\x1b[39m`, bold: (text) => `\x1b[1m${text}\x1b[22m` };
export const total = (h) => Object.values(h.counts).reduce((a, b) => a + b, 0);
export const linesEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
