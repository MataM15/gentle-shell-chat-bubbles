import { compact, SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SUMMARY_RESERVE_TOKENS = 16_384;
const COMPACTION_INSTRUCTIONS = [
	"Preserve the current user goal, constraints, accepted decisions, and exact next action.",
	"Preserve native SDD/review authority states, evidence revisions, machine tokens, task progress, blockers, and relevant files exactly.",
	"Distinguish completed, pending, blocked, and inherited-failure work; never claim unfinished work is complete.",
	"Keep enough implementation and verification detail to continue safely after compaction.",
].join(" ");

// Pi owns threshold checks, compaction persistence, cancellation, and continuation.
// Keep the historical filename so no resource-loading configuration must change.
export default function nativeCompactionFocus(pi: ExtensionAPI) {
	pi.on("session_before_compact", async (event, ctx) => {
		const model = ctx.model;
		if (!model || model.provider !== "openai-codex" || model.id !== "gpt-6.1-sol") return;

		const settings = SettingsManager.inMemory(pi.getSettings());
		const preparation = event.preparation;
		const focus = [COMPACTION_INSTRUCTIONS, event.customInstructions].filter(Boolean).join(" ");
		const fileOps = {
			read: new Set(preparation.fileOps.read),
			written: new Set(preparation.fileOps.written),
			edited: new Set(preparation.fileOps.edited),
		};
		// Pi does not carry file lists from hook-generated summaries automatically.
		const previous = [...event.branchEntries].reverse().find((entry) => entry.type === "compaction");
		if (previous?.type === "compaction" && previous.details?.nativeCompactionFocus === true) {
			for (const file of previous.details.readFiles ?? []) fileOps.read.add(file);
			for (const file of previous.details.modifiedFiles ?? []) fileOps.edited.add(file);
		}
		try {
			const result = await compact(
				{
					...preparation,
					fileOps,
					// reserveTokens controls both the trigger and summary output in Pi.
					// Raising the trigger reserve must not inflate the summary budget.
					settings: { ...preparation.settings, reserveTokens: SUMMARY_RESERVE_TOKENS },
				},
				model,
				undefined,
				undefined,
				undefined,
				event.signal,
				pi.getThinkingLevel(),
				(summaryModel, context, options) => ctx.modelRegistry.streamSimple(summaryModel, {
					...context,
					// compact() omits custom instructions from split-turn prefix summaries.
					// Supply focus to every summary request without mutating native input.
					messages: context.messages.map((message) => message.role !== "user" ? message : {
						...message,
						content: typeof message.content === "string"
							? `${message.content}\n\nAdditional focus: ${focus}`
							: [...message.content, { type: "text", text: `Additional focus: ${focus}` }],
					}),
				}, { ...options, transport: settings.getTransport() }),
				undefined,
				settings.getRetrySettings(),
			);
			return { compaction: { ...result, details: { ...result.details, nativeCompactionFocus: true } } };
		} catch (error) {
			// Do not fall through to a second, oversized default summarization request.
			// Cancellation also covers runtime replacement; never notify through stale ctx.
			if (!event.signal.aborted && ctx.hasUI) {
				ctx.ui.notify(`Compaction summary failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
			return { cancel: true };
		}
	});
}
