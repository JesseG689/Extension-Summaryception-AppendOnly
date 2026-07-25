import { applySafetyGap } from './safety-gap.js';
import {
    computeNarrativeSentenceCap,
    computeStateLineCap,
    STATE_KEY_CEILING,
} from './structural-constraints.js';

/**
 * Format a size target/max requirement line shared by L0 and L1+ prompt blocks.
 * @param {object} p
 * @param {string} p.label - Section label, e.g. '[NARRATIVE]' or '[STATE]'.
 * @param {number} p.softTarget - Token count the model should aim for.
 * @param {number} p.hardMax - Token count that must never be exceeded.
 * @param {string} [p.verb] - Optional leading clause between label and `aim ~`, e.g. 'rewrite the full snapshot;'.
 * @param {string} [p.extra] - Optional trailing clause (e.g. sentence/line caps).
 * @returns {string}
 */
export function buildSizeTargetLine({ label, softTarget, hardMax, verb = '', extra = '' }) {
    const verbClause = verb ? `${verb} ` : '';
    const base = `${label}: ${verbClause}aim ~${softTarget} tokens; never exceed ${hardMax}.`;
    return extra ? `${base} ${extra}` : base;
}

/**
 * Format the standalone size-constraints block appended to a prompt.
 * @param {object} p
 * @param {string} p.wrapperTag - XML-ish wrapper tag name without angle brackets.
 * @param {string} p.targetLine - Body line produced by buildSizeTargetLine.
 * @param {string} [p.repairLine] - Optional repair feedback appended inside the block.
 * @returns {string}
 */
export function buildSizeConstraintsBlock({ wrapperTag, targetLine, repairLine = '' }) {
    return `<${wrapperTag}>\n${targetLine}\n${repairLine}</${wrapperTag}>`;
}

/**
 * Build the `<summaryception_source_budget>` prompt block injected into the
 * Layer 0 prompt. Carries source-relative token budgets (with a 10% safety
 * gap applied to the real validation bounds) and model-countable structural
 * caps so the model can aim below the real ceilings on the first attempt.
 * @param {object} p
 * @param {number} p.sourceNarrativeTokens - Source passage token count.
 * @param {number} p.sourceStateTokens - Serialized prior [STATE] token count.
 * @param {number} p.sourceStateKeyCount - Keys present in the prior snapshot.
 * @param {{ target: number, max: number }} p.narrativeBounds - Real bounds from `getLayer0SummaryTokenBounds`.
 * @param {{ softTarget: number, max: number }} p.stateBounds - Real STATE_SNAPSHOT_SOFT_TARGET/MAX.
 * @returns {string} Prompt block text (no trailing newline).
 */
export function buildLayer0BudgetHint({
    sourceNarrativeTokens,
    sourceStateTokens,
    sourceStateKeyCount,
    narrativeBounds,
    stateBounds,
}) {
    const narrativeTarget = applySafetyGap(narrativeBounds.target);
    const narrativeMax = applySafetyGap(narrativeBounds.max);
    const sentenceCap = computeNarrativeSentenceCap(sourceNarrativeTokens);
    const stateTarget = applySafetyGap(stateBounds.softTarget);
    const stateMax = applySafetyGap(stateBounds.max);

    const hasState = Number(sourceStateTokens) > 0;
    const stateLineCap = hasState ? computeStateLineCap(sourceStateKeyCount) : STATE_KEY_CEILING;

    const existingStateLine = hasState
        ? `Existing [STATE]: ~${sourceStateTokens} tokens, ${sourceStateKeyCount} keys.`
        : 'No existing [STATE] yet — build the first snapshot.';

    return [
        '<summaryception_source_budget>',
        `Source passage: ~${sourceNarrativeTokens} tokens. Compress hard.`,
        buildSizeTargetLine({
            label: '[NARRATIVE]',
            softTarget: narrativeTarget,
            hardMax: narrativeMax,
            extra: `At most ${sentenceCap} sentences.`,
        }),
        existingStateLine,
        buildSizeTargetLine({
            label: '[STATE]',
            softTarget: stateTarget,
            hardMax: stateMax,
            verb: 'rewrite the full snapshot;',
            extra: `At most ${stateLineCap} lines.`,
        }),
        '</summaryception_source_budget>',
    ].join('\n');
}
