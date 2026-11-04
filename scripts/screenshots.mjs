// Renders example bubbles and tool cards with the sakura-dusk theme and saves
// PNG screenshots under docs/. Needs a Pi install (see tests/render-cache-harness.mjs)
// and a Chromium binary in CHROMIUM (defaults to the Playwright headless shell).
// Run: node --experimental-transform-types scripts/screenshots.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

process.env.PI_BUBBLE_LABEL ??= "Gentle";
process.env.FORCE_COLOR ??= "3"; // colors are stripped outside a TTY
process.env.COLORTERM ??= "truecolor"; // otherwise the theme downgrades to the 256-color palette
const root = resolve(import.meta.dirname, "..");
const modules = process.env.PI_NODE_MODULES ?? resolve(homedir(), ".pi/agent/npm/node_modules");
const themeModule = await import(pathToFileURL(resolve(modules, "@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js")));
const { pi, load } = await import("../tests/render-cache-harness.mjs");
const theme = themeModule.loadThemeFromPath(resolve(root, "themes/sakura-dusk.json"), "dark");
themeModule.setThemeInstance(theme);

const WIDTH = 78;
const out = resolve(root, "docs");
mkdirSync(out, { recursive: true });

function bubbles() {
	const handlers = {};
	load("assistant-bubbles").assistantBubbles({ on: (name, fn) => (handlers[name] = fn), registerCommand() {} });
	handlers.session_start({}, { hasUI: true, ui: { theme } });
	const user = (text) => new pi.UserMessageComponent(text);
	const asst = (content, hide) => new pi.AssistantMessageComponent({ role: "assistant", content, stopReason: "stop" }, hide);
	return [
		user("Can you check the last commit and tell me if anything broke?"),
		asst([{ type: "thinking", thinking: "Read the diff first, then run the failing tests." }, { type: "text", text: "Done." }], false),
		asst([{ type: "text", text: "I checked the commit and found three things:\n\n1. The render test fails at 37 columns.\n2. The phone breakpoint is missing.\n3. Everything else is fine." }]),
	].flatMap((c) => c.render(WIDTH));
}

function cards() {
	const defs = {};
	load("compact-tool-cards").compactToolCards({ on() {}, registerTool: (def) => (defs[def.name] = def) });
	const ctx = (args, isError) => ({ state: {}, args, isError, expanded: false, executionStarted: true, invalidate: () => true, cwd: root });
	const card = (name, args, text, isError = false) => {
		const c = ctx(args, isError);
		const call = defs[name].renderCall(args, theme, c);
		defs[name].renderResult({ content: [{ type: "text", text }], details: {}, isError }, { expanded: false, isPartial: false }, theme, c);
		return call.render(WIDTH);
	};
	return [
		...card("bash", { command: "pnpm test" }, "# tests 11\n# pass 11\n# fail 0"),
		...card("read", { path: "extensions/assistant-bubbles.ts" }, Array(526).fill("x").join("\n")),
		...card("edit", { path: "README.md", oldText: "a", newText: "b" }, "Successfully replaced text in README.md."),
		...card("grep", { pattern: "PI_BUBBLE_LABEL", path: "extensions" }, "extensions/assistant-bubbles.ts:95: const ASSISTANT_LABEL"),
		...card("bash", { command: "git push" }, "fatal: no remote configured", true),
	];
}

function palette256(n) {
	if (n < 16) return ["#000","#c33","#3c3","#cc3","#33c","#c3c","#3cc","#ccc","#888","#f66","#6f6","#ff6","#66f","#f6f","#6ff","#fff"][n];
	if (n >= 232) { const v = 8 + (n - 232) * 10; return `rgb(${v},${v},${v})`; }
	const i = n - 16, step = (k) => (k === 0 ? 0 : 55 + k * 40);
	return `rgb(${step(Math.floor(i / 36))},${step(Math.floor(i / 6) % 6)},${step(i % 6)})`;
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function ansiToHtml(lines) {
	return lines
		.map((line) => {
			let html = "";
			let style = { color: null, bold: false, dim: false, italic: false };
			const span = (text) => {
				if (!text) return "";
				const css = [style.color && `color:${style.color}`, style.bold && "font-weight:bold", style.dim && "opacity:.6", style.italic && "font-style:italic"].filter(Boolean).join(";");
				return css ? `<span style="${css}">${esc(text)}</span>` : esc(text);
			};
			const clean = line.replace(/\x1b\][^\x07]*\x07/g, "");
			const re = /\x1b\[([0-9;]*)m/g;
			let last = 0, m;
			while ((m = re.exec(clean))) {
				html += span(clean.slice(last, m.index));
				last = re.lastIndex;
				const codes = m[1].split(";").map(Number);
				for (let i = 0; i < codes.length; i++) {
					const c = codes[i];
					if (c === 0) style = { color: null, bold: false, dim: false, italic: false };
					else if (c === 1) style.bold = true;
					else if (c === 2) style.dim = true;
					else if (c === 3) style.italic = true;
					else if (c === 22) style.bold = style.dim = false;
					else if (c === 23) style.italic = false;
					else if (c === 39) style.color = null;
					else if (c === 38 && codes[i + 1] === 2) { style.color = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
					else if (c === 38 && codes[i + 1] === 5) { style.color = palette256(codes[i + 2]); i += 2; }
				}
			}
			html += span(clean.slice(last));
			return html;
		})
		.join("\n");
}

function page(lines) {
	return `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:radial-gradient(ellipse at 20% 0%,#3a2237 0%,#1b1522 55%,#120f18 100%);}
pre{margin:0;padding:18px 20px;font:15px/1.25 "DejaVu Sans Mono","Ubuntu Mono",monospace;color:#dee0e1;white-space:pre;}
</style><pre>${ansiToHtml(lines)}</pre>`;
}

function chromium() {
	if (process.env.CHROMIUM) return process.env.CHROMIUM;
	const base = resolve(homedir(), ".cache/ms-playwright");
	const dir = existsSync(base) ? readdirSync(base).find((d) => d.startsWith("chromium_headless_shell")) : undefined;
	return dir && resolve(base, dir, "chrome-headless-shell-linux64/chrome-headless-shell");
}

for (const [name, lines] of [["bubbles", bubbles()], ["tool-cards", cards()]]) {
	const html = resolve(out, `${name}.html`);
	writeFileSync(html, page(lines));
	const bin = chromium();
	if (!bin) { console.log(`no chromium; wrote ${html}`); continue; }
	const height = lines.length * 19 + 40;
	execFileSync(bin, ["--headless", "--no-sandbox", "--hide-scrollbars", `--window-size=760,${height}`, `--screenshot=${resolve(out, `${name}.png`)}`, pathToFileURL(html).href], { stdio: "ignore" });
	console.log(`wrote docs/${name}.png`);
}
