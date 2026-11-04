// Tests for assistant-bubbles.ts (phone-compact bubbles, byte-identical above 60 columns).
// Run: node --experimental-transform-types --test tests/assistant-bubbles.test.mjs
// The in-memory harness uses live Pi modules read-only (override with PI_NODE_MODULES).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The fixtures were drawn with this label; keep it so the expected rows stay literal.
process.env.PI_BUBBLE_LABEL = "J.A.R.V.I.S.";
process.env.PI_BUBBLE_USER_LABEL = "Vos";
const nodeModules = process.env.PI_NODE_MODULES ?? join(homedir(), ".pi/agent/npm/node_modules");
const skip = existsSync(join(nodeModules, "@earendil-works/pi-coding-agent")) ? false : "Pi install not found";

const strip = (line) => line.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "").replace(/<\/?[a-zA-Z]+>/g, "");
const plain = (lines) => lines.map(strip);

let h;
async function setup() {
	if (h) return h;
	const { pi, tui, load } = await import("./render-cache-harness.mjs");
	const ext = load("assistant-bubbles").assistantBubbles;
	const handlers = {};
	ext({ on: (name, fn) => (handlers[name] = fn), registerCommand() {} });
	pi.initTheme("dark", false);
	handlers.session_start({}, { hasUI: true, ui: { theme: { fg: (c, t) => `<${c}>${t}</${c}>` } } });
	const user = (text) => new pi.UserMessageComponent(text);
	const asst = (content, hide) => new pi.AssistantMessageComponent({ role: "assistant", content, stopReason: "stop" }, hide);
	const cases = {
		user2: () => user("Podés revisar el último commit y decirme si algo se rompió?"),
		asst5: () =>
			asst([{ type: "text", text: "Revisé el commit y encontré tres cosas:\n\n1. El test de render falla en 37 columnas.\n2. Falta el breakpoint.\n3. El resto está bien y no hay nada más para cambiar." }]),
		thoughtCollapsed: () => asst([{ type: "thinking", thinking: "Voy a mirar el diff primero." }, { type: "text", text: "Listo." }], true),
		thoughtExpanded: () =>
			asst([{ type: "thinking", thinking: "Voy a mirar el diff primero y después los tests que fallan en la terminal." }, { type: "text", text: "Listo." }], false),
	};
	return (h = { cases, tui });
}

// Captured from the original (pre-compact) extension with the tagged fake theme above.
const GOLDEN_61 = {
 "user2@61": [
  "\u001b]133;A\u0007  <accent>╭───────────────────────────────────────────────── </accent>\u001b[1m<accent>Vos</accent>\u001b[22m<accent> ─╮</accent>",
  "  <accent>│</accent>                                                       <accent>│</accent>",
  "  <accent>│</accent>  \u001b[38;2;222;224;225mPodés revisar el último commit y decirme si algo se\u001b[0m\u001b[0m  <accent>│</accent>",
  "  <accent>│</accent>  \u001b[38;2;222;224;225mrompió?\u001b[39m                                            \u001b[0m\u001b[0m  <accent>│</accent>",
  "  <accent>│</accent>                                                       <accent>│</accent>",
  "  <accent>╰─────────────────────────────────────────────────╮ ╭───╯</accent>",
  "\u001b]133;B\u0007\u001b]133;C\u0007                                                     <accent>╲│</accent>"
 ],
 "asst5@61": [
  "\u001b]133;A\u0007",
  "  <border>╭─ </border>\u001b[1m<border>Pi</border>\u001b[22m<border> ───────────────────────────────────────────╮</border>",
  "  <border>│</border>                                                <border>│</border>",
  "  <border>│</border>  Revisé el commit y encontré tres cosas:     \u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>                                              \u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>  \u001b[38;2;167;152;215m1. \u001b[39mEl test de render falla en 37 columnas.  \u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>  \u001b[38;2;167;152;215m2. \u001b[39mFalta el breakpoint.                     \u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>  \u001b[38;2;167;152;215m3. \u001b[39mEl resto está bien y no hay nada más para\u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>     cambiar.                                 \u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>                                                <border>│</border>",
  "  <border>╰───╮ ╭──────────────────────────────────────────╯</border>",
  "\u001b]133;B\u0007\u001b]133;C\u0007  <border>    │╱</border>"
 ],
 "thoughtCollapsed@61": [
  "\u001b]133;A\u0007",
  "  <thinkingText>╭┄┄┄┄┄┄┄┄┄┄┄┄┄╮</thinkingText>",
  "  <thinkingText>┆</thinkingText> \u001b[38;2;150;160;164mThinking...\u001b[39m \u001b[0m\u001b[0m<thinkingText>┆</thinkingText>",
  "  <thinkingText>╰┄┄┄┄┄┄┄┄┄┄┄┄┄╯</thinkingText>",
  "  <thinkingText>  ○</thinkingText>",
  "  <thinkingText> ∘</thinkingText>",
  "",
  "  <border>╭─ </border>\u001b[1m<border>Pi</border>\u001b[22m<border> ─────╮</border>",
  "  <border>│</border>          <border>│</border>",
  "  <border>│</border>  Listo.\u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>          <border>│</border>",
  "  <border>╰───╮ ╭────╯</border>",
  "\u001b]133;B\u0007\u001b]133;C\u0007  <border>    │╱</border>"
 ],
 "thoughtExpanded@61": [
  "\u001b]133;A\u0007",
  "  <thinkingText>╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮</thinkingText>",
  "  <thinkingText>┆</thinkingText> \u001b[38;2;150;160;164mVoy a mirar el diff primero y después los tests que   \u001b[0m<thinkingText>┆</thinkingText>",
  "  <thinkingText>┆</thinkingText> \u001b[38;2;150;160;164mfallan en la terminal.\u001b[39m                                \u001b[0m<thinkingText>┆</thinkingText>",
  "  <thinkingText>╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯</thinkingText>",
  "  <thinkingText>  ○</thinkingText>",
  "  <thinkingText> ∘</thinkingText>",
  "",
  "  <border>╭─ </border>\u001b[1m<border>Pi</border>\u001b[22m<border> ─────╮</border>",
  "  <border>│</border>          <border>│</border>",
  "  <border>│</border>  Listo.\u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>          <border>│</border>",
  "  <border>╰───╮ ╭────╯</border>",
  "\u001b]133;B\u0007\u001b]133;C\u0007  <border>    │╱</border>"
 ]
};
const GOLDEN_100 = {
 "user2@100": [
  "\u001b]133;A\u0007                                 <accent>╭───────────────────────────────────────────────────────── </accent>\u001b[1m<accent>Vos</accent>\u001b[22m<accent> ─╮</accent>",
  "                                 <accent>│</accent>                                                               <accent>│</accent>",
  "                                 <accent>│</accent>  \u001b[38;2;222;224;225mPodés revisar el último commit y decirme si algo se rompió?\u001b[0m\u001b[0m  <accent>│</accent>",
  "                                 <accent>│</accent>                                                               <accent>│</accent>",
  "                                 <accent>╰─────────────────────────────────────────────────────────╮ ╭───╯</accent>",
  "\u001b]133;B\u0007\u001b]133;C\u0007                                                                                            <accent>╲│</accent>"
 ],
 "asst5@100": [
  "\u001b]133;A\u0007",
  "  <border>╭─ </border>\u001b[1m<border>Pi</border>\u001b[22m<border> ────────────────────────────────────────────────────╮</border>",
  "  <border>│</border>                                                         <border>│</border>",
  "  <border>│</border>  Revisé el commit y encontré tres cosas:              \u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>                                                       \u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>  \u001b[38;2;167;152;215m1. \u001b[39mEl test de render falla en 37 columnas.           \u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>  \u001b[38;2;167;152;215m2. \u001b[39mFalta el breakpoint.                              \u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>  \u001b[38;2;167;152;215m3. \u001b[39mEl resto está bien y no hay nada más para cambiar.\u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>                                                         <border>│</border>",
  "  <border>╰───╮ ╭───────────────────────────────────────────────────╯</border>",
  "\u001b]133;B\u0007\u001b]133;C\u0007  <border>    │╱</border>"
 ],
 "thoughtCollapsed@100": [
  "\u001b]133;A\u0007",
  "  <thinkingText>╭┄┄┄┄┄┄┄┄┄┄┄┄┄╮</thinkingText>",
  "  <thinkingText>┆</thinkingText> \u001b[38;2;150;160;164mThinking...\u001b[39m \u001b[0m\u001b[0m<thinkingText>┆</thinkingText>",
  "  <thinkingText>╰┄┄┄┄┄┄┄┄┄┄┄┄┄╯</thinkingText>",
  "  <thinkingText>  ○</thinkingText>",
  "  <thinkingText> ∘</thinkingText>",
  "",
  "  <border>╭─ </border>\u001b[1m<border>Pi</border>\u001b[22m<border> ─────╮</border>",
  "  <border>│</border>          <border>│</border>",
  "  <border>│</border>  Listo.\u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>          <border>│</border>",
  "  <border>╰───╮ ╭────╯</border>",
  "\u001b]133;B\u0007\u001b]133;C\u0007  <border>    │╱</border>"
 ],
 "thoughtExpanded@100": [
  "\u001b]133;A\u0007",
  "  <thinkingText>╭┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╮</thinkingText>",
  "  <thinkingText>┆</thinkingText> \u001b[38;2;150;160;164mVoy a mirar el diff primero y después los tests que fallan en la terminal.\u001b[39m                   \u001b[0m<thinkingText>┆</thinkingText>",
  "  <thinkingText>╰┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄╯</thinkingText>",
  "  <thinkingText>  ○</thinkingText>",
  "  <thinkingText> ∘</thinkingText>",
  "",
  "  <border>╭─ </border>\u001b[1m<border>Pi</border>\u001b[22m<border> ─────╮</border>",
  "  <border>│</border>          <border>│</border>",
  "  <border>│</border>  Listo.\u001b[0m\u001b[0m  <border>│</border>",
  "  <border>│</border>          <border>│</border>",
  "  <border>╰───╮ ╭────╯</border>",
  "\u001b]133;B\u0007\u001b]133;C\u0007  <border>    │╱</border>"
 ]
};

// Preserve original goldens; transform only the assistant header and the width-dependent
// right padding/bottom of short speech boxes that need room for the longer label.
function renamedAssistantGolden(lines) {
	let extra = 0;
	return lines.map((line) => {
		const match = line.match(/<border>Pi<\/border>(\x1b\[22m<border> )(─+)╮<\/border>/);
		if (match) {
			extra = Math.max(0, 10 - match[2].length);
			return line.replace(match[0], `<border>J.A.R.V.I.S.</border>${match[1]}${"─".repeat(match[2].length + extra - 10)}╮</border>`);
		}
		if (!extra) return line;
		if (line.includes("<border>╰───╮ ╭")) return line.replace("╯</border>", `${"─".repeat(extra)}╯</border>`);
		if (line.includes("<border>│</border>") && line.endsWith("<border>│</border>")) {
			if (line.includes("\x1b[0m\x1b[0m")) return line.replace("\x1b[0m\x1b[0m", `${" ".repeat(extra)}\x1b[0m\x1b[0m`);
			return line.replace(/<border>│<\/border>$/, `${" ".repeat(extra)}<border>│</border>`);
		}
		return line;
	});
}

test("widths above 60 preserve original rendering apart from the assistant label and necessary width", { skip }, async () => {
	const { cases } = await setup();
	for (const [width, golden] of [[61, GOLDEN_61], [100, GOLDEN_100]]) {
		for (const name of Object.keys(cases)) {
			const expected = golden[`${name}@${width}`];
			assert.deepEqual(cases[name]().render(width), name === "user2" ? expected : renamedAssistantGolden(expected), `${name}@${width}`);
		}
	}
});

test("width 60 is compact, width 61 is not", { skip }, async () => {
	const { cases } = await setup();
	const at60 = plain(cases.user2().render(60));
	const at61 = plain(cases.user2().render(61));
	const blankInner = (lines) => lines.filter((line) => /^\s*│\s+│$/.test(line)).length;
	assert.equal(at60.length, 5);
	assert.equal(blankInner(at60), 0);
	assert.equal(blankInner(at61), 2);
	assert.ok(at60.every((line) => line.length <= 60));
	assert.ok(!at60.some((line) => /^\s*│\s+│$/.test(line)), "no blank inner rows at 60");
});

test("compact bubbles at 37 columns have no inner blank rows and use the full width", { skip }, async () => {
	const { cases } = await setup();
	const user = plain(cases.user2().render(37));
	const asst = plain(cases.asst5().render(37));
	assert.equal(user.length, 5);
	assert.equal(asst.length, 12);
	assert.ok(user[0].trimStart().startsWith("╭") && user[0].endsWith("Vos ─╮"));
	assert.ok(user.slice(1, 3).every((line) => line.trimStart().startsWith("│ ") && line.length <= 37));
	assert.equal(user[0].length, 37, "user bubble is right-aligned to the edge with no margin");
	// Row 0 of the assistant output is Pi's leading spacer; the bubble itself starts flush at column 0.
	assert.ok(asst[1].startsWith("╭─ J.A.R.V.I.S. ") && asst[1].length === 36, "box fits the text, margin 0");
	assert.ok(asst.at(-2).startsWith("╰───╮ ╭") && asst.at(-1) === "    │╱");
	// Only the markdown paragraph break may be blank inside the border.
	const inner = asst.slice(2, -2);
	assert.ok(!/^│\s+│$/.test(inner[0]) && !/^│\s+│$/.test(inner.at(-1)));
	for (const line of inner) assert.ok(line.startsWith("│") && line.endsWith("│") && line.length === 36);
});

test("assistant label fits short text at phone and desktop widths, without overflow at narrow widths", { skip }, async () => {
	const { cases, tui } = await setup();
	for (const width of [37, 60, 61, 100]) {
		const lines = plain(cases.thoughtCollapsed().render(width));
		assert.ok(lines.some((line) => line.includes("╭─ J.A.R.V.I.S. ")), `width ${width}`);
		assert.ok(lines.some((line) => line.includes("Listo.")), `short reply content at ${width}`);
		assert.ok(lines.every((line) => tui.visibleWidth(line) <= width));
	}
	for (let width = 1; width < 10; width++) assert.doesNotThrow(() => cases.asst5().render(width), `native fallback ${width}`);
	for (let width = 10; width < 18; width++) {
		const lines = plain(cases.asst5().render(width));
		assert.ok(lines.every((line) => tui.visibleWidth(line) <= width), `width ${width}`);
	}
});

test("compact thought bubbles keep the dotted border with a single tail circle", { skip }, async () => {
	const { cases } = await setup();
	for (const name of ["thoughtCollapsed", "thoughtExpanded"]) {
		const lines = plain(cases[name]().render(37)).slice(1); // row 0 is Pi's leading spacer
		assert.equal(lines[0][0], "╭");
		assert.ok(lines[0].includes("┄"));
		const bottom = lines.findIndex((line) => line.startsWith("╰┄"));
		assert.ok(bottom > 1);
		assert.equal(lines[bottom + 1], "  ○");
		assert.equal(lines[bottom + 2], "", "the second tail circle is gone");
	}
});

test("hit layout matches the painted compact bubble", { skip }, async () => {
	const { cases, tui } = await setup();
	const seen = [];
	for (const cls of [tui.MouseRegion, tui.Markdown]) {
		cls.prototype.handleMouse = function (event) {
			seen.push({ x: event.x, y: event.y, width: event.width });
			return undefined;
		};
	}
	const bubbleOf = (component, n) => component.contentContainer.children.filter((c) => c.constructor.name === "Bubble")[n];
	const click = (bubble, x, y, width) => {
		seen.length = 0;
		bubble.handleMouse({ type: "press", x, y, width, height: 20 });
		return [...seen];
	};

	// Collapsed thought: row 0 border, row 1 text, row 2 border.
	const thought = cases.thoughtCollapsed();
	const tb = bubbleOf(thought, 0);
	const rows = plain(tb.render(37));
	const textRow = rows.findIndex((line) => line.includes("Thinking..."));
	assert.equal(textRow, 1, "bubble itself starts at its own row 0");
	const textStart = rows[textRow].indexOf("Thinking") - 1; // Pi's own 1-column padding precedes the text
	assert.equal(click(tb, 0, 0, 37).length, 0, "top border is not a hit");
	assert.equal(click(tb, 0, 2, 37).length, 0, "bottom border is not a hit");
	assert.equal(click(tb, 0, 1, 37).length, 0, "left border column is not a hit");
	const hit = click(tb, textStart + 1, 1, 37);
	assert.ok(hit.length > 0, "a click on the painted text reaches Pi's region");
	assert.equal(hit[0].y, 0);
	assert.equal(hit[0].x, textStart, "x is shifted by the border only (margin 0, padding 1)");
	assert.equal(click(tb, rows[textRow].length, 1, 37).length, 0, "right border column is not a hit");

	// Speech: bodyTop is 1 in compact mode (top border only), so row 1 is the first text row.
	const sb = bubbleOf(cases.asst5(), 0);
	const srows = plain(sb.render(37));
	assert.equal(click(sb, 5, 0, 37).length, 0, "top border is not a hit");
	assert.ok(click(sb, 5, 1, 37).length > 0, "first text row is a hit");
	assert.equal(click(sb, 5, 1, 37)[0].y, 0, "first text row maps to the first rendered line");
	assert.ok(click(sb, 5, srows.length - 3, 37).length > 0, "last text row is a hit");
	assert.equal(click(sb, 5, srows.length - 2, 37).length, 0, "bottom border is not a hit");
});
