// Assistant bubbles: draws assistant replies inside comic-style balloons.
// Each bubble retains one framed result, polling inner lines on every frame;
// width/settings/theme changes and invalidate() discard it (streaming still updates).
//   - text / errors  -> rounded SPEECH bubble fitted to its text, labelled "Assistant" (PI_BUBBLE_LABEL), with a
//                       tail growing out of the bottom border
//   - thinking       -> dotted rounded THOUGHT bubble with a tail of small circles
//                       (compact while hidden, full width once expanded)
// Both share a 2-column left margin.
// On phone-width terminals (render width <= 60, Gentle Shell's PHONE_COLUMNS) the bubbles
// go compact: no margin, 1-column padding, no blank rows inside the border and a
// single-circle thought tail, so every row and column goes to the text.
// The user's own messages get the mirrored speech bubble: right-aligned, labelled
// "You" (PI_BUBBLE_USER_LABEL), drawn in the theme's accent color, with the tail growing out of the
// bottom-right.
// No background is painted, so the terminal wallpaper stays visible. `/bubbles`
// toggles everything for the session.
//
// Pi has no public API for this, so the extension wraps
// AssistantMessageComponent.prototype.updateContent: after Pi rebuilds the
// message's children, they are regrouped into bubble components that live
// inside the real component tree. Because the bubbles are real components that
// translate mouse coordinates, Pi's own click-to-toggle on the thinking label
// (MouseRegion) keeps hitting the right rows. The original method is kept in a
// global slot so /reload never double-patches, and it is restored on
// session_shutdown. If a Pi update renames the component, the extension
// degrades to a no-op instead of breaking the chat.
// UserMessageComponent is wrapped the same way, but through render(): the bubble
// is drawn from a background-free clone of the message's Markdown, so the original
// component is never mutated and toggling off returns Pi's exact output.
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, MouseRegion, Spacer, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const ORIGINAL_KEY = Symbol.for("assistant-bubbles.originalUpdateContent");
const USER_ORIGINAL_KEY = Symbol.for("assistant-bubbles.originalUserRender");
const USER_INVALIDATE_KEY = Symbol.for("assistant-bubbles.originalUserInvalidate");
const LEGACY_RENDER_KEY = Symbol.for("assistant-bubbles.originalRender");
const STATE_KEY = Symbol.for("assistant-bubbles.state");
const RESET = "\x1b[0m";
const MIN_WIDTH = 8;

type UpdateFn = (this: any, message: any, isStreaming?: boolean) => void;
type Kind = "speech" | "thought";
interface State {
	enabled: boolean;
	getTheme: () => Theme | undefined;
}

const proto = (AssistantMessageComponent as any)?.prototype as
	| { updateContent: UpdateFn; render: (width: number) => string[] }
	| undefined;

const userProto = (UserMessageComponent as any)?.prototype as { render: (width: number) => string[] } | undefined;

const g = globalThis as Record<symbol, any>;
// Shared through globalThis so bubbles created before a /reload follow the live toggle.
const state: State = (g[STATE_KEY] ??= { enabled: true, getTheme: () => undefined });

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const isBlank = (line: string) => line.replace(ANSI_RE, "").trim() === "";
const trailingSpaces = (line: string) => {
	const plain = line.replace(ANSI_RE, "");
	return plain.length - plain.trimEnd().length;
};

// Speech uses Pi's border color; thought uses the quieter thinking color.
const TOKEN: Record<Kind, string> = { speech: "border", thought: "thinkingText" };

function currentTheme(): Theme | undefined {
	try { return state.getTheme(); } catch { return undefined; }
}

function paint(kind: Kind, text: string): string {
	try {
		return state.getTheme()?.fg(TOKEN[kind] as any, text) ?? text;
	} catch {
		return text;
	}
}

interface Layout {
	width: number;
	renderWidth: number;
	innerHeight: number;
	trimTop: number;
	bodyRows: number;
	bodyTop: number;
	left: number;
	contentWidth: number;
}

const MARGIN = 2;
const MIN_BOX = 10;
// Bubble label: set PI_BUBBLE_LABEL (for example "J.A.R.V.I.S.") to rename it.
const ASSISTANT_LABEL = process.env.PI_BUBBLE_LABEL?.trim() || "Assistant";
// User bubble label: set PI_BUBBLE_USER_LABEL to rename it.
const USER_LABEL = process.env.PI_BUBBLE_USER_LABEL?.trim() || "You";
const BOLD = (text: string) => `\x1b[1m${text}\x1b[22m`;
// [left margin (also kept free on the right), inner horizontal padding], tried in order.
const SPEECH_STEPS: Array<[number, number]> = [[MARGIN, 2], [0, 2], [0, 1], [0, 0]];
// Phone widths: no margin, 1-column padding (Pi's own padding already covers it), then none.
const PHONE_COLUMNS = 60;
const PHONE_SPEECH_STEPS: Array<[number, number]> = [[0, 1], [0, 0]];
const isPhone = (width: number) => width <= PHONE_COLUMNS;

class Bubble {
	private inner = new Container();
	private layout: Layout | undefined;
	private cache?: { width: number; kind: Kind; compact: boolean; pad: number; theme: Theme | undefined; lines: string[]; output: string[]; layout: Layout };
	private polled?: { width: number; lines: string[] };
	private measured?: string[];

	constructor(
		private kind: Kind,
		children: any[],
		private compact: boolean,
		private outputPad: number,
	) {
		for (const child of children) this.inner.addChild(child);
	}

	invalidate(): void {
		this.cache = undefined;
		this.inner.invalidate();
	}

	render(width: number): string[] {
		this.layout = undefined;
		this.polled = undefined;
		this.measured = undefined;
		try {
			const theme = currentTheme();
			const cached = this.cache;
			this.cache = undefined;
			if (state.enabled && width >= MIN_WIDTH && cached && cached.width === width &&
				cached.kind === this.kind && cached.compact === this.compact &&
				cached.pad === this.outputPad && cached.theme === theme) {
				const lines = this.inner.render(cached.layout.renderWidth);
				if (sameLines(lines, cached.lines)) {
					this.cache = cached;
					this.layout = cached.layout;
					return cached.output;
				}
				this.polled = { width: cached.layout.renderWidth, lines };
			}
			const output = this.frame(width);
			if (output && this.layout && this.measured) {
				this.cache = { width, kind: this.kind, compact: this.compact, pad: this.outputPad,
					theme, lines: this.measured, output, layout: this.layout };
			}
			return output ?? this.inner.render(width);
		} catch {
			this.cache = undefined;
			this.layout = undefined;
			return this.inner.render(width);
		} finally {
			this.polled = undefined;
			this.measured = undefined;
		}
	}

	// Hit-testing: shift the pointer into the child's own coordinate space so
	// Pi's MouseRegion/Container row math sees the same layout it rendered.
	handleMouse(event: any): any {
		if (!this.layout || this.layout.width !== event.width) {
			this.render(event.width);
		}
		const l = this.layout;
		if (!l) return this.inner.handleMouse(event);
		if (event.y < l.bodyTop || event.y >= l.bodyTop + l.bodyRows) return undefined;
		if (event.x < l.left || event.x >= l.left + l.contentWidth) return undefined;
		return this.inner.handleMouse({
			...event,
			x: event.x - l.left,
			y: event.y - l.bodyTop + l.trimTop,
			width: l.renderWidth,
			height: l.innerHeight,
		});
	}

	private frame(width: number): string[] | undefined {
		if (!state.enabled || width < MIN_WIDTH) return undefined;
		return this.kind === "speech" ? this.speech(width) : this.thought(width);
	}

	// Renders the children and returns the non-blank body with its trim offset.
	private measure(renderWidth: number) {
		const lines = this.polled?.width === renderWidth ? this.polled.lines : this.inner.render(renderWidth);
		this.measured = lines.slice();
		let start = 0;
		let end = lines.length;
		while (start < end && isBlank(lines[start])) start++;
		while (end > start && isBlank(lines[end - 1])) end--;
		if (start === end) return undefined;
		const body = lines.slice(start, end);
		const widest = Math.max(...body.map((line) => visibleWidth(line) - trailingSpaces(line)));
		return { lines, start, body, widest };
	}

	// Speech: left margin, text-fitted width, 2-column padding, labelled top edge and a tail
	// that grows out of the bottom border. Degrades margin first, then padding, then native.
	private speech(width: number): string[] | undefined {
		const pad = this.outputPad;
		const phone = isPhone(width);
		for (const [margin, padding] of phone ? PHONE_SPEECH_STEPS : SPEECH_STEPS) {
			const gapL = Math.max(0, padding - pad);
			const maxBox = width - margin * 2;
			const maxContent = maxBox - 2 - gapL - padding;
			if (maxBox < MIN_BOX || maxContent < pad + 1) continue;
			// Pi leaves its own padding on the right of each line; render a little wider to reclaim it.
			const m = this.measure(maxContent + pad);
			if (!m) return undefined;
			const minBox = Math.min(maxBox, Math.max(MIN_BOX, visibleWidth(ASSISTANT_LABEL) + 5));
			const contentWidth = Math.max(minBox - 2 - gapL - padding, Math.min(maxContent, m.widest));
			const inner = gapL + contentWidth + padding;
			const boxWidth = inner + 2;
			const side = paint("speech", "│");
			const lead = " ".repeat(margin);
			const left = " ".repeat(gapL);
			const right = " ".repeat(padding);
			const blank = `${lead}${side}${" ".repeat(inner)}${side}`;
			const rows = m.body.map((line) => {
				const fitted = truncateToWidth(line, contentWidth, "");
				const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(fitted)));
				return `${lead}${side}${left}${fitted}${RESET}${fill}${right}${side}`;
			});
			const label = truncateToWidth(ASSISTANT_LABEL, boxWidth - 5, "");
			const top = `${lead}${paint("speech", "╭─ ")}${BOLD(paint("speech", label))}${paint("speech", ` ${"─".repeat(boxWidth - 5 - visibleWidth(label))}╮`)}`;
			const bottom = `${lead}${paint("speech", `╰───╮ ╭${"─".repeat(boxWidth - 8)}╯`)}`;
			const tail = `${lead}${paint("speech", "    │╱")}`;
			this.layout = {
				width,
				renderWidth: maxContent + pad,
				innerHeight: m.lines.length,
				trimTop: m.start,
				bodyRows: m.body.length,
				bodyTop: phone ? 1 : 2,
				left: margin + 1 + gapL,
				contentWidth,
			};
			return phone ? [top, ...rows, bottom, tail] : [top, blank, ...rows, blank, bottom, tail];
		}
		return undefined;
	}

	// Thought: dotted border and circle tail, shifted by the shared margin (expanded also keeps it free on the right).
	private thought(width: number): string[] | undefined {
		// Pi's own horizontal padding already sits inside the content; top up to one column per side.
		const wanted = Math.max(0, 1 - this.outputPad);
		// Expanded keeps the margin free on both sides; degrades margin first, then padding.
		const phone = isPhone(width);
		const steps: Array<[number, number]> = phone
			? [[0, wanted]]
			: this.compact
				? [[width - MARGIN >= MIN_WIDTH ? MARGIN : 0, wanted]]
				: [[MARGIN, wanted], [0, wanted], [0, 0]];
		const [margin, extra] =
			steps.find(([mg]) => width - mg * (this.compact ? 1 : 2) >= MIN_WIDTH) ?? steps[steps.length - 1];
		const renderWidth = width - margin * (this.compact ? 1 : 2) - 2 - extra * 2;
		const m = this.measure(renderWidth);
		if (!m) return undefined;

		let contentWidth = renderWidth;
		if (this.compact) contentWidth = Math.max(1, Math.min(renderWidth, m.widest + this.outputPad));
		const boxWidth = contentWidth + 2 + extra * 2;
		const side = paint("thought", "┆");
		const lead = " ".repeat(margin);
		const gap = " ".repeat(extra);

		const rows = m.body.map((line) => {
			const fitted = truncateToWidth(line, contentWidth, "");
			const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(fitted)));
			return `${lead}${side}${gap}${fitted}${RESET}${fill}${gap}${side}`;
		});
		const top = `${lead}${paint("thought", `╭${"┄".repeat(boxWidth - 2)}╮`)}`;
		const bottom = `${lead}${paint("thought", `╰${"┄".repeat(boxWidth - 2)}╯`)}`;
		const tailRows = [`${lead}${paint("thought", "  ○")}`, `${lead}${paint("thought", " ∘")}`];
		const tail = boxWidth >= 6 ? (phone ? tailRows.slice(0, 1) : tailRows) : [];

		this.layout = {
			width,
			renderWidth,
			innerHeight: m.lines.length,
			trimTop: m.start,
			bodyRows: m.body.length,
			bodyTop: 1,
			left: margin + 1 + extra,
			contentWidth,
		};
		return [top, ...rows, bottom, ...tail];
	}
}

function sameLines(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((line, i) => line === b[i]);
}

const isKind = (child: any, cls: Function, name: string) => child instanceof cls || child?.constructor?.name === name;

// Regroup the children Pi just built: thinking regions become thought bubbles,
// text and error lines become one speech bubble, spacers stay outside.
function wrapChildren(self: any): void {
	const content = self.contentContainer;
	if (!content || !Array.isArray(content.children)) return;
	const outputPad = typeof self.outputPad === "number" ? self.outputPad : 1;

	type Group = { kind: Kind | "raw"; children: any[]; compact?: boolean };
	const groups: Group[] = [];
	let pending: any[] = [];
	const flushPending = () => {
		for (const spacer of pending) groups.push({ kind: "raw", children: [spacer] });
		pending = [];
	};

	for (const child of content.children as any[]) {
		if (isKind(child, Spacer, "Spacer")) {
			pending.push(child);
		} else if (isKind(child, MouseRegion, "MouseRegion")) {
			flushPending();
			groups.push({ kind: "thought", children: [child], compact: isKind(child.child, Text, "Text") });
		} else {
			const last = groups[groups.length - 1];
			if (last?.kind === "speech") {
				last.children.push(...pending, child);
				pending = [];
			} else {
				flushPending();
				groups.push({ kind: "speech", children: [child] });
			}
		}
	}
	flushPending();

	content.clear();
	for (const group of groups) {
		if (group.kind === "raw") content.addChild(group.children[0]);
		else content.addChild(new Bubble(group.kind, group.children, group.compact ?? false, outputPad));
	}
}

// ---- User bubble: the speech bubble mirrored to the right edge ----
const OSC_START = "\x1b]133;A\x07";
const OSC_END = "\x1b]133;B\x07\x1b]133;C\x07";

function paintAccent(text: string): string {
	try {
		return state.getTheme()?.fg("accent" as any, text) ?? text;
	} catch {
		return text;
	}
}

// One background-free Markdown clone per original Markdown (rebuild() makes a new original, so a new clone).
const flatClones = new WeakMap<object, Markdown>();
function sameOptions(a: any, b: any, omit?: string): boolean {
	const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
	return [...keys].every((key) => key === omit || a?.[key] === b?.[key]);
}

function flatMarkdown(original: any): Markdown {
	let clone = flatClones.get(original);
	if (!clone || ["text", "paddingX", "paddingY", "theme"].some((key) => (clone as any)[key] !== original[key]) ||
		!sameOptions((clone as any).options, original.options) ||
		!sameOptions((clone as any).defaultTextStyle, original.defaultTextStyle, "bgColor")) {
		clone = new Markdown(
			original.text,
			original.paddingX,
			original.paddingY,
			original.theme,
			{ ...original.defaultTextStyle, bgColor: undefined },
			original.options,
		);
		flatClones.set(original, clone);
	}
	return clone;
}

// Weak ownership, with only the last width retained for each user component.
const userCaches = new WeakMap<object, { width: number; pad: number; theme: Theme | undefined; markdown: Markdown; lines: string[]; output: string[] }>();

function userBubble(self: any, width: number): string[] | undefined {
	if (width < MIN_WIDTH) return undefined;
	const original = self.children?.[0];
	if (!original || typeof original.paddingX !== "number" || !original.theme) return undefined;
	const markdown = flatMarkdown(original);
	const pad = typeof self.outputPad === "number" ? self.outputPad : original.paddingX;
	const phone = isPhone(width);
	const theme = currentTheme();
	const cached = userCaches.get(self);
	userCaches.delete(self);
	for (const [margin, padding] of phone ? PHONE_SPEECH_STEPS : SPEECH_STEPS) {
		const gapL = Math.max(0, padding - pad);
		const maxBox = width - margin * 2;
		const maxContent = maxBox - 2 - gapL - padding;
		if (maxBox < MIN_BOX || maxContent < pad + 1) continue;
		const lines = markdown.render(maxContent + pad);
		if (cached && cached.width === width && cached.pad === pad && cached.theme === theme &&
			cached.markdown === markdown && sameLines(lines, cached.lines)) {
			userCaches.set(self, cached);
			return cached.output;
		}
		let start = 0;
		let end = lines.length;
		while (start < end && isBlank(lines[start])) start++;
		while (end > start && isBlank(lines[end - 1])) end--;
		if (start === end) return undefined;
		const body = lines.slice(start, end);
		const widest = Math.max(...body.map((line) => visibleWidth(line) - trailingSpaces(line)));
		const contentWidth = Math.max(MIN_BOX - 2 - gapL - padding, Math.min(maxContent, widest));
		const inner = gapL + contentWidth + padding;
		const boxWidth = inner + 2;
		// Right-aligned: the bubble ends `margin` columns before the edge; nothing trails it.
		const lead = " ".repeat(width - margin - boxWidth);
		const side = paintAccent("│");
		const blank = `${lead}${side}${" ".repeat(inner)}${side}`;
		const rows = body.map((line) => {
			const fitted = truncateToWidth(line, contentWidth, "");
			const fill = " ".repeat(Math.max(0, contentWidth - visibleWidth(fitted)));
			return `${lead}${side}${" ".repeat(gapL)}${fitted}${RESET}${fill}${" ".repeat(padding)}${side}`;
		});
		const top = `${lead}${paintAccent(`╭${"─".repeat(boxWidth - 5 - visibleWidth(USER_LABEL))} `)}${BOLD(paintAccent(USER_LABEL))}${paintAccent(" ─╮")}`;
		const bottom = `${lead}${paintAccent(`╰${"─".repeat(boxWidth - 8)}╮ ╭───╯`)}`;
		const tail = `${lead}${" ".repeat(boxWidth - 6)}${paintAccent("╲│")}`;
		const out = phone ? [top, ...rows, bottom, tail] : [top, blank, ...rows, blank, bottom, tail];
		out[0] = OSC_START + out[0];
		out[out.length - 1] = OSC_END + out[out.length - 1];
		userCaches.set(self, { width, pad, theme, markdown, lines: lines.slice(), output: out });
		return out;
	}
	return undefined;
}

function installUser(): void {
	if (!userProto || typeof userProto.render !== "function") return;
	const original = g[USER_ORIGINAL_KEY] ?? userProto.render;
	g[USER_ORIGINAL_KEY] = original;
	userProto.render = function (this: any, width: number) {
		if (state.enabled) {
			try {
				const lines = userBubble(this, width);
				if (lines) return lines;
			} catch {
				// Fall through to Pi's own output.
			}
		}
		userCaches.delete(this);
		return original.call(this, width);
	};
	const invalidate = g[USER_INVALIDATE_KEY] ?? (userProto as any).invalidate;
	if (typeof invalidate === "function") {
		g[USER_INVALIDATE_KEY] = invalidate;
		(userProto as any).invalidate = function (this: any) {
			userCaches.delete(this);
			const markdown = this.children?.[0];
			if (markdown) {
				flatClones.get(markdown)?.invalidate();
				flatClones.delete(markdown);
			}
			return invalidate.call(this);
		};
	}
}

function uninstallUser(): void {
	const original = g[USER_ORIGINAL_KEY];
	if (userProto && original) userProto.render = original;
	delete g[USER_ORIGINAL_KEY];
	if (userProto && g[USER_INVALIDATE_KEY]) (userProto as any).invalidate = g[USER_INVALIDATE_KEY];
	delete g[USER_INVALIDATE_KEY];
}

function removeLegacyRenderPatch(): void {
	const legacy = g[LEGACY_RENDER_KEY];
	if (proto && legacy) proto.render = legacy;
	delete g[LEGACY_RENDER_KEY];
}

function install(): void {
	if (!proto || typeof proto.updateContent !== "function") return;
	removeLegacyRenderPatch();
	installUser();
	// After an unclean reload the previous patch may still be installed; wrap the true original.
	const original: UpdateFn = g[ORIGINAL_KEY] ?? proto.updateContent;
	g[ORIGINAL_KEY] = original;
	proto.updateContent = function (this: any, message: any, isStreaming?: boolean) {
		if (isStreaming === undefined) original.call(this, message);
		else original.call(this, message, isStreaming);
		try {
			wrapChildren(this);
		} catch {
			// Leave Pi's own children untouched.
		}
	};
}

function uninstall(): void {
	const original = g[ORIGINAL_KEY];
	if (proto && original) proto.updateContent = original;
	delete g[ORIGINAL_KEY];
	removeLegacyRenderPatch();
	uninstallUser();
	// Bubbles that already exist in the tree fall back to Pi's plain output.
	state.enabled = false;
}

export default function assistantBubbles(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		state.enabled = true;
		const ui = ctx.ui;
		state.getTheme = () => ui.theme;
		install();
	});

	pi.on("session_shutdown", () => {
		uninstall();
		state.getTheme = () => undefined;
	});

	pi.registerCommand("bubbles", {
		description: "Toggle speech and thought bubbles around assistant replies and your messages",
		handler: async (_args, ctx) => {
			state.enabled = !state.enabled;
			// Resetting the label makes Pi re-render every assistant message.
			ctx.ui.setHiddenThinkingLabel();
			ctx.ui.notify(`Assistant bubbles ${state.enabled ? "on" : "off"}`, "info");
		},
	});
}
