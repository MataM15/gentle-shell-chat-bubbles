// A single last-width cache snapshots summary scalars (summaries may mutate).
// Theme changes and invalidate() force refitting, including streaming outcomes.
// Compact codemode card: renders the `codemode` tool as one line, e.g.
//   ╭──────────────────────────────────────────╮
//   │ ⚙ codemode · read, bash, todo ✓ · 10.2s │
//   ╰──────────────────────────────────────────╯
// No background, just a state-colored rounded box (2-column margin on both sides). Ctrl+O (app.tools.expand)
// switches to Pi's native codemode renderer, re-framed in the same state-colored
// rounded box (no background fill).
//
// Only rendering is overridden, through pi.registerToolRenderer(). The tool itself is
// neither registered nor wrapped here, so execution, permissions, the sandbox, and
// settings stay exactly as Pi's built-in codemode extension wires them. If codemode is
// disabled, no call is ever rendered and the resolver just passes every tool through.
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { type Component, Container, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { RoundedFrame, toneOf } from "./compact-tool-cards.ts";

const TOOL_NAME = "codemode";
const STATE_KEY = "__compactCodemodeCard";
const ICON = "⚙";
const CUE_MAX = 48;

interface Call {
	name?: string;
	status?: string;
	error?: string;
}

interface Summary {
	names: string;
	outcome: "running" | "ok" | "error";
	cue: string;
	duration: string;
}

const MARGIN = 2;
const MIN_BOX = 8;

/** Rounded one-line box in the state color: 2-col margin on both sides, 1-col inner padding. */
function boxed(theme: Theme | undefined, token: "muted" | "success" | "error", width: number, fill: (inner: number) => string): string[] {
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

class CardLine implements Component {
	theme?: Theme;
	summary?: Summary;
	private cache?: { width: number; theme: Theme | undefined; summary: Summary | undefined; output: string[] };
	render(width: number): string[] {
		const { theme, summary } = this;
		const cached = this.cache;
		if (cached && cached.width === width && cached.theme === theme &&
			cached.summary?.names === summary?.names && cached.summary?.outcome === summary?.outcome &&
			cached.summary?.cue === summary?.cue && cached.summary?.duration === summary?.duration) return cached.output;
		this.cache = undefined;
		let output: string[];
		if (!theme || !summary) output = boxed(undefined, "muted", width, () => `${ICON} ${TOOL_NAME}`);
		else {
			const { outcome } = summary;
			const token = outcome === "ok" ? "success" : outcome === "error" ? "error" : "muted";
			output = boxed(theme, token, width, (inner) => fit(theme, summary, Math.max(1, inner)));
		}
		this.cache = { width, theme, summary: summary ? { ...summary } : undefined, output };
		return output;
	}
	invalidate(): void { this.cache = undefined; }
}

interface Slots {
	card: CardLine;
	empty: Container;
	frame?: RoundedFrame;
	startedAt?: number;
	hasResult?: boolean;
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

function oneLine(value: unknown, max = CUE_MAX): string {
	const text = String(value ?? "").split("\n").find((line) => line.trim())?.replace(/\s+/g, " ").trim() ?? "";
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function textOf(result: any): string {
	return (result?.content ?? [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => c.text as string)
		.join("\n");
}

/** Inner tool names in call order; consecutive repeats become `name ×N`. */
function namesOf(calls: Call[]): string {
	const groups: { name: string; count: number }[] = [];
	for (const call of calls) {
		const name = call.name || "?";
		const last = groups[groups.length - 1];
		if (last?.name === name) last.count++;
		else groups.push({ name, count: 1 });
	}
	return groups.map((g) => (g.count > 1 ? `${g.name} ×${g.count}` : g.name)).join(", ");
}

function formatSeconds(seconds: number): string {
	return seconds < 1 ? `${Math.round(seconds * 1000)}ms` : `${seconds.toFixed(1)}s`;
}

/** Live elapsed time for a running script; hidden for the first second. */
function elapsed(startedAt: number | undefined): string {
	const seconds = startedAt === undefined ? 0 : (Date.now() - startedAt) / 1000;
	return seconds >= 1 ? formatSeconds(seconds) : "";
}

function errorCue(calls: Call[], text: string): string {
	const failed = calls.find((call) => call.status === "error");
	if (failed) return oneLine(failed.error ? `${failed.name}: ${failed.error}` : `${failed.name} failed`);
	const script = text.split("\n").findIndex((line) => line.startsWith("Script error:"));
	if (script >= 0) {
		const lines = text.split("\n");
		const inline = lines[script].slice("Script error:".length).trim();
		return oneLine(inline || lines.slice(script + 1).join("\n"));
	}
	return oneLine(text.replace(/^Script failed\nWall time [\d.]+ seconds\nOutput:\n/, "")) || "script failed";
}

function summarize(result: any, isPartial: boolean, isError: boolean, startedAt: number | undefined): Summary {
	const calls: Call[] = result?.details?.calls ?? [];
	const text = textOf(result);
	const wall = text.match(/Wall time ([\d.]+) seconds/);
	let duration = "";
	if (wall) duration = formatSeconds(Number(wall[1]));
	else duration = elapsed(startedAt);

	const failed = isError || calls.some((call) => call.status === "error");
	if (isPartial) return { names: namesOf(calls), outcome: "running", cue: "", duration };
	return {
		names: namesOf(calls),
		outcome: failed ? "error" : "ok",
		cue: failed ? errorCue(calls, text) : "",
		duration,
	};
}

/** Builds the line for `width`, dropping the hint first, then shortening the names. */
function fit(theme: Theme, s: Summary, width: number): string {
	const dot = theme.fg("dim", "·");
	const head = `${ICON} ${theme.fg("toolTitle", theme.bold(TOOL_NAME))}`;
	const status =
		s.outcome === "running"
			? theme.fg("warning", "running")
			: s.outcome === "ok"
				? theme.fg("success", "✓")
				: theme.fg("error", `✗${s.cue ? ` ${s.cue}` : ""}`);
	const tail = s.duration ? ` ${dot} ${theme.fg("dim", s.duration)}` : "";
	const hint = `  ${theme.fg("muted", "(")}${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;

	const build = (names: string, withHint: boolean): string => {
		const list = names ? ` ${dot} ${theme.fg("accent", names)}` : "";
		return `${head}${list} ${status}${tail}${withHint && s.outcome !== "running" ? hint : ""}`;
	};

	for (const withHint of [true, false]) {
		const line = build(s.names, withHint);
		if (visibleWidth(line) <= width) return line;
	}
	// Shorten the names list until the line fits.
	const bare = visibleWidth(build("", false)) + 3; // " · " before the list
	const room = width - bare;
	if (s.names && room >= 2) return build(truncateToWidth(s.names, room, "…"), false);
	return truncateToWidth(build("", false), width, "…");
}

/** Export contexts pass a no-op invalidate; keep the native script view there. */
function isStaticExport(context: any): boolean {
	return typeof context?.invalidate === "function" && context.invalidate.toString().replace(/\s+/g, "") === "()=>{}";
}

export function wrapCodemodeRenderers(native: ToolRenderers | undefined): ToolRenderers | undefined {
	if (!native?.renderCall || !native.renderResult) return native;
	const nativeCall = native.renderCall;
	const nativeResult = native.renderResult;

	return {
		...native,
		renderShell: "self",

		renderCall(args, theme, context) {
			if (isStaticExport(context)) return nativeCall(args, theme, context);
			const s = slots(context.state);
			if (context.executionStarted) s.startedAt ??= Date.now();
			if (context.expanded) {
				const component = nativeCall(args, theme, { ...context, lastComponent: s.nativeCall });
				s.nativeCall = component;
				s.frame ??= new RoundedFrame();
				s.frame.theme = theme;
				s.frame.tone = toneOf(!s.hasResult || context.isPartial, context.isError);
				s.frame.set(component);
				return s.frame;
			}
			s.card.theme = theme;
			// A result render (which follows this call render) fills in the real summary.
			if (!s.hasResult) {
				s.card.summary = { names: "", outcome: "running", cue: "", duration: elapsed(s.startedAt) };
			}
			return s.card;
		},

		renderResult(result, options, theme, context) {
			if (isStaticExport(context)) return nativeResult(result, options, theme, context);
			const s = slots(context.state);
			s.startedAt ??= Date.now();
			s.hasResult = true;
			if (options.expanded) {
				const component = nativeResult(result, options, theme, { ...context, lastComponent: s.nativeResult });
				s.nativeResult = component;
				s.frame ??= new RoundedFrame();
				s.frame.theme = theme;
				s.frame.tone = toneOf(options.isPartial, context.isError);
				s.frame.set(...(s.nativeCall ? [s.nativeCall, component] : [component]));
				return s.empty;
			}
			s.card.theme = theme;
			s.card.summary = summarize(result, options.isPartial, context.isError, s.startedAt);
			return s.empty;
		},
	};
}

export default function compactCodemodeCard(pi: ExtensionAPI) {
	pi.registerToolRenderer((toolName, next) => {
		const native = next();
		return toolName === TOOL_NAME ? wrapCodemodeRenderers(native) : native;
	});
}
