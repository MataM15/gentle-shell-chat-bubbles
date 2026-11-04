// Tool cards for everything the other two extensions do not cover (web tools, MCP and
// dynamically enabled tools, CodeGraph, todo, memory, questionnaires, ...). Presentation
// only: it is a tool-renderer resolver, so no tool is registered, wrapped or executed here.
//
// Tools are sorted by what their native renderer declares, never by a hardcoded id, so a
// tool enabled later in the session is covered the moment its first call is rendered:
//   - default shell (Pi would paint a status-colored Box) or no renderer at all: one-line
//     state-colored rounded card, and the same rounded frame around the native view when
//     expanded (Ctrl+O, app.tools.expand);
//   - renderShell "self" (the tool draws itself): the native view is kept as is and only
//     gets the 2-column card margin, unless it already has one (e.g. subagent boxes), so
//     nothing is wrapped twice and controls keep their hit testing.
// bash/read/grep/find/ls/edit/write and codemode belong to their own extensions and are
// passed through untouched. Static HTML export keeps the native views.
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { type Component, Container, getCapabilities, getImageDimensions, imageFallback, Text } from "@earendil-works/pi-tui";
import { CardLine, isStaticExport, MarginBlock, RoundedFrame, type Tone, TOOLS, toneOf } from "./compact-tool-cards.ts";

const ICON = "🧩";
const STATE_KEY = "__compactOtherToolCards";
const MARK = Symbol.for("pi.compactOtherToolCards");
const OWNED = new Set<string>([...TOOLS, "codemode"]);
const CUE_MAX = 60;
const SUMMARY_MAX = 28;
const FALLBACK_PREVIEW_LINES = 10;
const CUE_KEYS = ["query", "url", "urls", "path", "file", "name", "action", "command", "pattern", "topic", "id"];

type AnyRenderers = ToolRenderers & { [MARK]?: true };

interface Slots {
	card: CardLine;
	frame: RoundedFrame;
	empty: Container;
	callBlock: MarginBlock;
	resultBlock: MarginBlock;
	nativeCall?: Component;
	nativeResult?: Component;
	callFailed?: boolean;
	/** What the expanded frame shows for the call: the native view or Pi's default fallback. */
	displayCall?: Component;
}

function slots(state: Record<string, unknown>): Slots {
	let s = state[STATE_KEY] as Slots | undefined;
	if (!s) {
		s = {
			card: new CardLine(),
			frame: new RoundedFrame(),
			empty: new Container(),
			callBlock: new MarginBlock(),
			resultBlock: new MarginBlock(),
		};
		state[STATE_KEY] = s;
	}
	return s;
}

function oneLine(value: unknown, max: number): string {
	const first = String(value ?? "").split("\n").find((line) => line.trim()) ?? "";
	const text = first.replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Pi's getTextOutput runs stripAnsi + sanitizeBinaryOutput on result text, but neither is exported
// (package exports block deep imports), so this mirrors them (pi-coding-agent utils/ansi.js and
// utils/shell.js): OSC and CSI sequences, then C0 controls except tab/LF/CR and U+FFF9..U+FFFB.
const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
const ANSI = new RegExp(`(?:\\u001B\\][\\s\\S]*?${ST})|[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]`, "g");
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFF9-\uFFFB]/g;

function textOf(result: any): string {
	return (result?.content ?? [])
		.filter((c: any) => c?.type === "text")
		.map((c: any) => String(c.text ?? "").replace(ANSI, "").replace(CONTROL, "").replace(/\r/g, ""))
		.join("\n");
}

/** The most telling argument, shown after the tool name on the card. */
function cue(args: any): string {
	if (args == null || typeof args !== "object") return oneLine(args, CUE_MAX);
	const pick = (value: unknown): string | undefined => {
		const candidate = Array.isArray(value) ? value[0] : value;
		return typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : undefined;
	};
	for (const key of CUE_KEYS) {
		const found = pick(args[key]);
		if (found) return oneLine(found, CUE_MAX);
	}
	for (const value of Object.values(args)) {
		const found = typeof value === "string" ? value : undefined;
		if (found?.trim()) return oneLine(found, CUE_MAX);
	}
	return "";
}

function header(toolName: string, args: any, theme: Theme): string {
	const detail = cue(args);
	return `${ICON} ${theme.fg("toolTitle", theme.bold(toolName))}${detail ? ` ${theme.fg("dim", detail)}` : ""}`;
}

function status(result: any, isPartial: boolean, isError: boolean, theme: Theme): string {
	if (isPartial) return theme.fg("muted", "…");
	const text = textOf(result);
	if (isError) return theme.fg("error", `✗ ${oneLine(text, SUMMARY_MAX) || "failed"}`);
	const hasImage = (result?.content ?? []).some((c: any) => c?.type === "image");
	const summary = oneLine(text, SUMMARY_MAX) || (hasImage ? "image" : "done");
	return `${theme.fg("success", `✓ ${summary}`)} ${theme.fg("dim", "·")} ${keyHint("app.tools.expand", "detail")}`;
}

/** Same shape as Pi's own fallback for tools without a call renderer. */
function fallbackCall(toolName: string, args: any, theme: Theme, expanded: boolean): Component {
	const title = theme.fg("toolTitle", theme.bold(toolName));
	if (args == null || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length === 0) {
		return new Text(args == null ? title : `${title} ${theme.fg("muted", JSON.stringify(args))}`, 0, 0);
	}
	if (expanded) {
		const lines = Object.entries(args).map(([key, value]) => {
			const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
			return `  ${key}: ${text.replace(/\r/g, "").split("\n").join("\n    ")}`;
		});
		return new Text(`${title}\n${theme.fg("muted", lines.join("\n"))}`, 0, 0);
	}
	const pairs = Object.entries(args).map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`).join(" ");
	return new Text(`${title} ${theme.fg("muted", oneLine(pairs, 100))}`, 0, 0);
}

/** Pi's getTextOutput: when the image is not drawn (no terminal support or images off), say so in text. */
function outputOf(result: any, showImages: boolean): string {
	const text = textOf(result);
	const images = (result?.content ?? []).filter((c: any) => c?.type === "image");
	if (images.length === 0 || (getCapabilities().images && showImages)) return text;
	const notes = images
		.map((img: any) => {
			const mimeType = img.mimeType ?? "image/unknown";
			const dims = img.data && img.mimeType ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
			return imageFallback(mimeType, dims);
		})
		.join("\n");
	return text ? `${text}\n${notes}` : notes;
}

/** Same shape as Pi's own fallback for tools without a result renderer. */
function fallbackResult(result: any, expanded: boolean, theme: Theme, showImages: boolean): Component {
	const output = outputOf(result, showImages);
	if (!output) return new Container();
	const lines = output.split("\n");
	const shown = expanded ? lines : lines.slice(0, FALLBACK_PREVIEW_LINES);
	let text = shown.map((line) => theme.fg("toolOutput", line)).join("\n");
	if (shown.length < lines.length) {
		text += `${theme.fg("muted", `\n... (${lines.length - shown.length} more lines,`)} ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
	}
	return new Text(text, 0, 0);
}

function noNative(): never {
	throw new Error("no native renderer"); // Pi's HTML export falls back to its structured view
}

/** Tools that draw themselves: keep their view, add the card margin. */
function withMargin(toolName: string, native: ToolRenderers): ToolRenderers {
	return {
		...native,
		renderShell: "self",
		renderCall(args, theme, context) {
			if (isStaticExport(context)) return native.renderCall ? native.renderCall(args, theme, context) : noNative();
			const s = slots(context.state);
			const component = native.renderCall
				? native.renderCall(args, theme, { ...context, lastComponent: s.nativeCall })
				: fallbackCall(toolName, args, theme, context.expanded);
			if (native.renderCall) s.nativeCall = component;
			s.callBlock.child = component;
			return s.callBlock;
		},
		renderResult(result, options, theme, context) {
			if (isStaticExport(context)) return native.renderResult ? native.renderResult(result, options, theme, context) : noNative();
			const s = slots(context.state);
			const component = native.renderResult
				? native.renderResult(result, options, theme, { ...context, lastComponent: s.nativeResult })
				: fallbackResult(result, options.expanded, theme, context.showImages);
			if (native.renderResult) s.nativeResult = component;
			s.resultBlock.child = component;
			return s.resultBlock;
		},
	};
}

/** Frame todo's native call and result together without shortening its messages. */
function frameTodo(native: ToolRenderers): ToolRenderers {
	return {
		...native,
		renderShell: "self",
		renderCall(args, theme, context) {
			if (isStaticExport(context)) return native.renderCall ? native.renderCall(args, theme, context) : noNative();
			const s = slots(context.state);
			try {
				s.nativeCall = native.renderCall ? native.renderCall(args, theme, { ...context, lastComponent: s.nativeCall }) : fallbackCall("todo", args, theme, context.expanded);
				s.callFailed = false;
			} catch (error) {
				s.nativeCall = undefined;
				s.callFailed = true;
				throw error;
			}
			s.frame.theme = theme;
			s.frame.tone = toneOf(context.isPartial, context.isError);
			s.frame.set(s.nativeCall);
			return s.frame;
		},
		renderResult(result, options, theme, context) {
			if (isStaticExport(context)) return native.renderResult ? native.renderResult(result, options, theme, context) : noNative();
			const s = slots(context.state);
			s.nativeResult = native.renderResult ? native.renderResult(result, options, theme, { ...context, lastComponent: s.nativeResult }) : fallbackResult(result, options.expanded, theme, context.showImages);
			s.frame.theme = theme;
			s.frame.tone = toneOf(options.isPartial, context.isError);
			s.frame.set(...(s.nativeCall ? [s.nativeCall, s.nativeResult] : [s.nativeResult]));
			if (s.nativeCall) return s.empty;
			if (s.callFailed) return s.frame;
			s.resultBlock.child = s.nativeResult;
			return s.resultBlock;
		},
	};
}

/** Tools Pi would paint with a status Box (or draw as plain text): card + rounded frame. */
function asCard(toolName: string, native: ToolRenderers | undefined): ToolRenderers {
	const show = (s: Slots, theme: Theme, tone: Tone, args: unknown, line: string): Component => {
		s.card.theme = theme;
		s.card.tone = tone;
		s.card.head = header(toolName, args, theme);
		s.card.status = line;
		return s.card;
	};

	return {
		...native,
		renderShell: "self",

		renderCall(args, theme, context) {
			if (isStaticExport(context)) return native?.renderCall ? native.renderCall(args, theme, context) : noNative();
			const s = slots(context.state);
			if (context.expanded) {
				const component = native?.renderCall
					? native.renderCall(args, theme, { ...context, lastComponent: s.nativeCall })
					: fallbackCall(toolName, args, theme, true);
				if (native?.renderCall) s.nativeCall = component;
				s.displayCall = component;
				s.frame.theme = theme;
				s.frame.tone = toneOf(context.isPartial, context.isError);
				s.frame.set(component);
				return s.frame;
			}
			// Keep the native renderer's per-call state (timers, previews) current while collapsed.
			if (native?.renderCall) s.nativeCall = native.renderCall(args, theme, { ...context, lastComponent: s.nativeCall });
			const running = context.executionStarted ? theme.fg("warning", "running") : theme.fg("muted", "…");
			return show(s, theme, "pending", args, running);
		},

		renderResult(result, options, theme, context) {
			if (isStaticExport(context)) return native?.renderResult ? native.renderResult(result, options, theme, context) : noNative();
			const s = slots(context.state);
			if (options.expanded) {
				const component = native?.renderResult
					? native.renderResult(result, options, theme, { ...context, lastComponent: s.nativeResult })
					: fallbackResult(result, true, theme, context.showImages);
				if (native?.renderResult) s.nativeResult = component;
				s.frame.theme = theme;
				s.frame.tone = toneOf(options.isPartial, context.isError);
				const call = native?.renderCall ? s.nativeCall : (s.displayCall ??= fallbackCall(toolName, context.args, theme, true));
				s.frame.set(...(call ? [call, component] : [component]));
				return s.empty;
			}
			if (native?.renderResult) s.nativeResult = native.renderResult(result, options, theme, { ...context, lastComponent: s.nativeResult });
			const tone = toneOf(options.isPartial, context.isError);
			show(s, theme, tone, context.args, status(result, options.isPartial, context.isError, theme));
			return s.empty;
		},
	};
}

export function wrapOtherRenderers(toolName: string, native: ToolRenderers | undefined): ToolRenderers | undefined {
	if (OWNED.has(toolName) || (native as AnyRenderers | undefined)?.[MARK]) return native;
	const wrapped: AnyRenderers =
		native?.renderShell === "self" ? (toolName === "todo" ? frameTodo(native) : withMargin(toolName, native)) : asCard(toolName, native);
	wrapped[MARK] = true;
	return wrapped;
}

export default function compactOtherToolCards(pi: ExtensionAPI) {
	pi.registerToolRenderer((toolName, next) => wrapOtherRenderers(toolName, next()));
}
