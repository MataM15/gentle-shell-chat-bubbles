// Last-width caches skip repeated framing; expanded children are still rendered
// every frame and compared by value. Theme changes/invalidate() clear reuse.
// Compact tool cards: renders bash/read/grep/find/ls/edit/write as one-line
// cards with an icon and outcome: no background, just a state-colored rounded box
// (2-column margin on both sides, like the assistant bubbles). Ctrl+O (app.tools.expand) switches to Pi's native renderer, so the
// expanded view keeps the built-in content, re-framed here in the same
// transparent rounded frame (state-colored border, no background).
//
// Execution is delegated unchanged to Pi's own built-in tool definitions, built
// with the same options core uses (read.autoResizeImages, bash.commandPrefix,
// bash.shellPath). Only global settings are honored for those options, so an
// untrusted project can never change the shell through this extension.
import type { ExtensionAPI, Theme, ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	keyHint,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, Container, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";

type ToolName = "bash" | "read" | "grep" | "find" | "ls" | "edit" | "write";
type AnyDef = ToolDefinition<any, any, any>;

const ICONS: Record<ToolName, string> = {
	bash: "💻",
	read: "📖",
	grep: "🔎",
	find: "🧭",
	ls: "📂",
	edit: "🔧",
	write: "📝",
};

export const TOOLS = Object.keys(ICONS) as ToolName[];
const STATE_KEY = "__compactToolCards";
const CUE_MAX = 72;

export type Tone = "pending" | "success" | "error";

export const BORDER_COLOR = { pending: "muted", success: "success", error: "error" } as const;

const MARGIN = 2;
const MIN_BOX = 8;

/** Rounded one-line box in the state color: 2-col margin on both sides, 1-col inner padding. */
export function boxed(theme: Theme | undefined, token: "muted" | "success" | "error", width: number, fill: (inner: number) => string): string[] {
	const w = Math.max(1, width);
	const margin = w - MARGIN * 2 >= MIN_BOX ? MARGIN : 0;
	if (!theme || w < MIN_BOX) return [truncateToWidth(fill(Math.max(1, w)), w, "…")];
	const boxWidth = w - margin * 2;
	const inner = boxWidth - 4;
	const lead = " ".repeat(margin);
	const edge = (text: string) => theme.fg(token, text);
	const body = fill(inner);
	const pad = " ".repeat(Math.max(0, inner - visibleWidth(body)));
	return [
		`${lead}${edge(`╭${"─".repeat(boxWidth - 2)}╮`)}`,
		`${lead}${edge("│")} ${body}${pad} ${edge("│")}`,
		`${lead}${edge(`╰${"─".repeat(boxWidth - 2)}╯`)}`,
	];
}

export class CardLine implements Component {
	theme?: Theme;
	tone: Tone = "pending";
	head = "";
	status = "";
	private cache?: { width: number; theme: Theme | undefined; tone: Tone; head: string; status: string; output: string[] };
	render(width: number): string[] {
		const cached = this.cache;
		if (cached && cached.width === width && cached.theme === this.theme && cached.tone === this.tone &&
			cached.head === this.head && cached.status === this.status) return cached.output;
		this.cache = undefined;
		const output = boxed(this.theme, BORDER_COLOR[this.tone], width, (inner) => {
			const full = `${this.head}  ${this.status}`;
			if (visibleWidth(full) <= inner) return full;
			// Keep the outcome visible: shorten the header first.
			const room = inner - visibleWidth(this.status) - 2;
			if (room >= 4) return `${truncateToWidth(this.head, room, "…")}  ${this.status}`;
			return truncateToWidth(full, inner, "…");
		});
		this.cache = { width, theme: this.theme, tone: this.tone, head: this.head, status: this.status, output };
		return output;
	}
	invalidate(): void { this.cache = undefined; }
}

/** Layout shared by the expanded frame and its mouse hit-testing. */
function frameLayout(width: number): { framed: boolean; margin: number; inner: number } {
	const w = Math.max(1, width);
	if (w < MIN_BOX) return { framed: false, margin: 0, inner: w };
	const margin = w - MARGIN * 2 >= MIN_BOX ? MARGIN : 0;
	return { framed: true, margin, inner: w - margin * 2 - 4 };
}

/**
 * Expanded view: children inside the same state-colored rounded box as the one-line card,
 * no background fill. Mouse events are retargeted through a padding-only Box, so children
 * keep Pi's own hit testing; clicks on the border fall through (and toggle expansion).
 */
export class RoundedFrame implements Component {
	theme?: Theme;
	tone: Tone = "pending";
	private children: Component[] = [];
	private readonly hit = new Box(0, 0);
	private cache?: { width: number; theme: Theme | undefined; tone: Tone; lines: string[]; output: string[] };
	set(...children: Component[]): void {
		this.children = children;
		this.hit.children = children;
	}
	render(width: number): string[] {
		const { framed, margin, inner } = frameLayout(width);
		const lines = this.children.flatMap((child) => child.render(inner));
		const cached = this.cache;
		if (cached && cached.width === width && cached.theme === this.theme && cached.tone === this.tone &&
			lines.length === cached.lines.length && lines.every((line, i) => line === cached.lines[i])) return cached.output;
		this.cache = undefined;
		const save = (output: string[]) => {
			this.cache = { width, theme: this.theme, tone: this.tone, lines: lines.slice(), output };
			return output;
		};
		if (lines.length === 0) return save([]);
		if (!framed || !this.theme) return save(lines.map((line) => truncateToWidth(line, Math.max(1, width), "")));
		const edge = (text: string) => this.theme!.fg(BORDER_COLOR[this.tone], text);
		const lead = " ".repeat(margin);
		const boxWidth = inner + 4;
		const body = lines.map((line) => {
			const cut = truncateToWidth(line, inner, "");
			return `${lead}${edge("│")} ${cut}${" ".repeat(Math.max(0, inner - visibleWidth(cut)))} ${edge("│")}`;
		});
		return save([`${lead}${edge(`╭${"─".repeat(boxWidth - 2)}╮`)}`, ...body, `${lead}${edge(`╰${"─".repeat(boxWidth - 2)}╯`)}`]);
	}
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const { framed, margin } = frameLayout(event.width);
		const hit = this.hit as unknown as { paddingX: number; paddingY: number };
		hit.paddingX = framed ? margin + 2 : 0;
		hit.paddingY = framed ? 1 : 0;
		return this.hit.handleMouse(event);
	}
	invalidate(): void {
		this.cache = undefined;
		for (const child of this.children) child.invalidate?.();
	}
}

const LEADING_SGR = /^(?:\x1b\[[0-9;:]*m)*/;

/** True when every non-blank line already starts with the card margin (e.g. a component that draws its own rounded box). */
function hasOwnMargin(lines: string[]): boolean {
	let seen = false;
	for (const line of lines) {
		const rest = line.replace(LEADING_SGR, "");
		if (!rest.trim()) continue;
		seen = true;
		if (!rest.startsWith(" ".repeat(MARGIN))) return false;
	}
	return seen;
}

/**
 * Gives a plain component the 2-column card margin on both sides, unless it already
 * carries one (so boxes drawn by other extensions are never wrapped twice).
 *
 * Deciding needs the full-width render, but pi-tui Text caches a single width, so asking
 * for both widths every frame re-wraps the text twice. Once decided, later frames render
 * only the width that was used and reuse the output while that render is unchanged.
 */
export class MarginBlock implements Component {
	child?: Component;
	private shifted = false;
	private readonly hit = new Box(MARGIN, 0);
	private cache?: { child: Component; width: number; shifted: boolean; source: string[]; output: string[] };
	render(width: number): string[] {
		const child = this.child;
		this.shifted = false;
		if (!child) return [];
		const w = Math.max(1, width);
		const cached = this.cache;
		if (cached && cached.child === child && cached.width === w) {
			const source = child.render(cached.shifted ? w - MARGIN * 2 : w);
			if (source.length === cached.source.length && source.every((line, i) => line === cached.source[i])) {
				this.shifted = cached.shifted;
				return cached.output;
			}
		}
		this.cache = undefined;
		const full = child.render(w);
		let source = full;
		let output = full;
		if (w - MARGIN * 2 >= MIN_BOX && !hasOwnMargin(full)) {
			this.shifted = true;
			const lead = " ".repeat(MARGIN);
			source = child.render(w - MARGIN * 2);
			output = source.map((line) => (line ? `${lead}${line}` : line));
		}
		this.cache = { child, width: w, shifted: this.shifted, source: source.slice(), output };
		return output;
	}
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (!this.child) return undefined;
		if (!this.shifted) return this.child.handleMouse?.(event);
		this.hit.children = [this.child];
		return this.hit.handleMouse(event);
	}
	invalidate(): void {
		this.cache = undefined;
		this.child?.invalidate?.();
	}
}

/** Export contexts pass a no-op invalidate; keep the native view there. */
export function isStaticExport(context: any): boolean {
	return typeof context?.invalidate === "function" && context.invalidate.toString().replace(/\s+/g, "") === "()=>{}";
}

export function toneOf(isPartial: boolean | undefined, isError: boolean | undefined): Tone {
	return isPartial ? "pending" : isError ? "error" : "success";
}

interface Slots {
	card: CardLine;
	frame?: RoundedFrame;
	empty: Container;
	nativeCall?: Component;
	nativeResult?: Component;
}

function slots(state: Record<string, unknown>): Slots {
	let s = state[STATE_KEY] as Slots | undefined;
	if (!s) {
		s = { card: new CardLine(), empty: new Container() };
		state[STATE_KEY] = s;
	}
	return s;
}

function createDefinition(name: ToolName, cwd: string): AnyDef {
	let settings: SettingsManager | undefined;
	try {
		settings = SettingsManager.create(cwd, undefined, { projectTrusted: false });
	} catch {
		settings = undefined;
	}
	switch (name) {
		case "read":
			return createReadToolDefinition(cwd, { autoResizeImages: settings?.getImageAutoResize() ?? true });
		case "bash":
			return createBashToolDefinition(cwd, {
				commandPrefix: settings?.getShellCommandPrefix(),
				shellPath: settings?.getShellPath(),
			});
		case "edit":
			return createEditToolDefinition(cwd);
		case "write":
			return createWriteToolDefinition(cwd);
		case "grep":
			return createGrepToolDefinition(cwd);
		case "find":
			return createFindToolDefinition(cwd);
		case "ls":
			return createLsToolDefinition(cwd);
	}
}

function oneLine(value: unknown, max = CUE_MAX): string {
	const raw = String(value ?? "");
	const first = raw.split("\n").find((line) => line.trim()) ?? "";
	let text = first.replace(/\s+/g, " ").trim();
	const more = raw.trim().includes("\n");
	if (text.length > max) text = `${text.slice(0, max - 1)}…`;
	else if (more) text += " …";
	return text;
}

function shortPath(path: unknown, cwd: string): string {
	const p = String(path ?? "");
	if (!p) return "";
	if (isAbsolute(p)) {
		const rel = relative(cwd, p);
		if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return oneLine(rel);
		const home = homedir();
		if (p === home || p.startsWith(`${home}/`)) return oneLine(`~${p.slice(home.length)}`);
	}
	return oneLine(p);
}

function cue(name: ToolName, args: any, cwd: string): string {
	args = args ?? {};
	switch (name) {
		case "bash":
			return oneLine(args.command);
		case "read": {
			let text = shortPath(args.path ?? args.file_path, cwd);
			if (args.offset || args.limit) {
				const start = args.offset ?? 1;
				text += args.limit ? `:${start}-${start + args.limit - 1}` : `:${start}`;
			}
			return text;
		}
		case "grep": {
			let text = `"${oneLine(args.pattern, 40)}"`;
			if (args.path) text += ` in ${shortPath(args.path, cwd)}`;
			if (args.glob) text += ` (${oneLine(args.glob, 24)})`;
			return text;
		}
		case "find":
			return `${oneLine(args.pattern, 40)}${args.path ? ` in ${shortPath(args.path, cwd)}` : ""}`;
		case "ls":
			return shortPath(args.path || ".", cwd);
		case "edit": {
			const edits = Array.isArray(args.edits) ? args.edits.length : 0;
			return `${shortPath(args.path ?? args.file_path, cwd)}${edits > 1 ? ` · ${edits} edits` : ""}`;
		}
		case "write":
			return shortPath(args.path ?? args.file_path, cwd);
	}
}

function header(name: ToolName, args: any, theme: Theme, cwd: string): string {
	return `${ICONS[name]} ${theme.fg("toolTitle", theme.bold(name))} ${theme.fg("dim", cue(name, args, cwd))}`;
}

function textOf(result: any): string {
	return (result?.content ?? [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => c.text as string)
		.join("\n");
}

function countLines(text: string): number {
	return text.split("\n").filter((line) => line.trim()).length;
}

function plural(n: number, word: string, many = `${word}s`): string {
	return `${n} ${n === 1 ? word : many}`;
}

function errorSummary(name: ToolName, text: string): string {
	const lines = text.split("\n").filter((line) => line.trim());
	if (name === "bash") {
		const status = [...lines].reverse().find((line) => /Command (exited|timed out|aborted|terminated)/.test(line));
		const exit = status?.match(/exited with code (\d+)/);
		if (exit) return `exit ${exit[1]}`;
		if (status) return oneLine(status, 60);
	}
	return oneLine(lines[0] ?? "failed", 60);
}

function successSummary(name: ToolName, result: any, args: any): string {
	const text = textOf(result);
	switch (name) {
		case "bash":
			return plural(countLines(text), "line");
		case "read":
			if ((result?.content ?? []).some((c: any) => c?.type === "image")) return "image";
			return plural(text ? text.replace(/\n$/, "").split("\n").length : 0, "line");
		case "grep":
			return /^No matches found/.test(text.trim()) ? "no matches" : plural(countLines(text), "match", "matches");
		case "find":
			return /^No files found/.test(text.trim()) ? "no results" : plural(countLines(text), "result");
		case "ls":
			return /^\(empty directory\)/.test(text.trim()) ? "empty" : plural(countLines(text), "entry", "entries");
		case "edit": {
			const diff: string = result?.details?.diff ?? "";
			let add = 0;
			let del = 0;
			for (const line of diff.split("\n")) {
				if (line.startsWith("+") && !line.startsWith("+++")) add++;
				else if (line.startsWith("-") && !line.startsWith("---")) del++;
			}
			return diff ? `+${add} −${del}` : "applied";
		}
		case "write":
			return `written · ${plural(String(args?.content ?? "").split("\n").length, "line")}`;
	}
}

function isTruncated(details: any): boolean {
	return Boolean(
		details?.truncation?.truncated ||
			details?.matchLimitReached ||
			details?.resultLimitReached ||
			details?.entryLimitReached ||
			details?.linesTruncated,
	);
}

function pendingStatus(name: ToolName, theme: Theme, context: any): string {
	if (name === "bash" && typeof context.state?.startedAt === "number") {
		const seconds = Math.floor((Date.now() - context.state.startedAt) / 1000);
		return theme.fg("warning", `running ${seconds}s`);
	}
	return theme.fg("muted", "…");
}

function resultStatus(name: ToolName, result: any, isPartial: boolean, theme: Theme, context: any): string {
	if (isPartial) return pendingStatus(name, theme, context);
	if (context.isError) return theme.fg("error", `✗ ${errorSummary(name, textOf(result))}`);
	let text = theme.fg("success", `✓ ${successSummary(name, result, context.args)}`);
	if (isTruncated(result?.details)) text += theme.fg("warning", " · truncated");
	return `${text} ${theme.fg("dim", "·")} ${keyHint("app.tools.expand", "detail")}`;
}

function wrap(name: ToolName, native: AnyDef, definitionFor: (name: ToolName, cwd: string) => AnyDef): AnyDef {
	const show = (s: Slots, theme: Theme, tone: Tone, head: string, status: string): Component => {
		s.card.theme = theme;
		s.card.tone = tone;
		s.card.head = head;
		s.card.status = status;
		return s.card;
	};

	// Edit's native call is a Box painted with the status background; drop only that shell
	// fill (the diff colors inside stay) so it matches the background-free frame.
	const flatten = (component: Component | undefined) => {
		const setBgFn = (component as { setBgFn?: (fn: (text: string) => string) => void } | undefined)?.setBgFn;
		if (name !== "edit" || typeof setBgFn !== "function") return;
		setBgFn.call(component, (text) => text);
		// The shell Box also pads rows above and below; the frame already provides spacing.
		Object.assign(component as object, { paddingX: 0, paddingY: 0 });
	};

	return {
		...native,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return definitionFor(name, ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},

		renderCall(args, theme, context) {
			if (isStaticExport(context) && native.renderCall) return native.renderCall(args, theme, context);
			const s = slots(context.state);
			// Always run the native renderer so its per-call state (timers, diff previews) stays current.
			let nativeCall: Component | undefined;
			try {
				nativeCall = native.renderCall?.(args, theme, { ...context, lastComponent: s.nativeCall });
				s.nativeCall = nativeCall;
				flatten(nativeCall);
			} catch {
				nativeCall = undefined;
			}
			if (context.expanded && nativeCall) {
				s.frame ??= new RoundedFrame();
				s.frame.theme = theme;
				s.frame.tone = toneOf(context.isPartial, context.isError);
				s.frame.set(nativeCall);
				return s.frame;
			}

			const status = context.executionStarted ? pendingStatus(name, theme, context) : theme.fg("muted", "…");
			return show(s, theme, "pending", header(name, args, theme, context.cwd), status);
		},

		renderResult(result, options, theme, context) {
			if (isStaticExport(context) && native.renderResult) return native.renderResult(result, options, theme, context);
			const s = slots(context.state);
			let nativeResult: Component | undefined;
			try {
				nativeResult = native.renderResult?.(result, options, theme, { ...context, lastComponent: s.nativeResult });
				s.nativeResult = nativeResult;
				flatten(s.nativeCall);
			} catch {
				nativeResult = undefined;
			}
			if (options.expanded && nativeResult) {
				// The call render put the native call in the frame; the result joins it.
				s.frame ??= new RoundedFrame();
				s.frame.theme = theme;
				s.frame.tone = toneOf(options.isPartial, context.isError);
				s.frame.set(...(s.nativeCall ? [s.nativeCall, nativeResult] : [nativeResult]));
				return s.empty;
			}

			const status = resultStatus(name, result, options.isPartial, theme, context);
			const tone: Tone = options.isPartial ? "pending" : context.isError ? "error" : "success";
			show(s, theme, tone, header(name, context.args, theme, context.cwd), status);
			return s.empty;
		},
	} as AnyDef;
}

export default function compactToolCards(pi: ExtensionAPI) {
	const cache = new Map<string, AnyDef>();
	const definitionFor = (name: ToolName, cwd: string): AnyDef => {
		const key = `${cwd}\0${name}`;
		let def = cache.get(key);
		if (!def) {
			def = createDefinition(name, cwd);
			cache.set(key, def);
		}
		return def;
	};

	// Settings (shell path, image resize) are re-read when a session starts, like core does.
	pi.on("session_start", () => cache.clear());

	for (const name of TOOLS) {
		pi.registerTool(wrap(name, definitionFor(name, process.cwd()), definitionFor));
	}
}
