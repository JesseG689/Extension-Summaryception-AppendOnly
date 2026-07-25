import {
    computeSentenceCap,
    computeStateLineCap,
    STATE_KEY_CEILING,
} from './structural-constraints.js';

/**
 * Format a countable size-cap line shared by L0 and L1+ prompt blocks. The
 * model can count sentences/lines while streaming; it cannot count tokens,
 * so no token figures ever appear here.
 * @param {object} p
 * @param {string} p.label - Section label, e.g. '[NARRATIVE]' or '[STATE]'.
 * @param {number} p.cap - Countable cap (sentences or lines).
 * @param {string} p.unit - Countable unit, e.g. 'sentences' or 'lines'.
 * @param {string} [p.verb] - Optional leading clause between label and `at most`, e.g. 'rewrite the full snapshot;'.
 * @param {string} [p.extra] - Optional trailing clause.
 * @returns {string}
 */
export function buildSizeTargetLine({ label, cap, unit, verb = '', extra = '' }) {
    const verbClause = verb ? `${verb} ` : '';
    const base = `${label}: ${verbClause}at most ${cap} ${unit}.`;
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
 * Layer 0 prompt. Carries only model-countable structural caps (sentences,
 * state lines) anchored to the configured slider target; no token figures.
 * @param {object} p
 * @param {number} p.sourceStateTokens - Serialized prior [STATE] token count.
 * @param {number} p.sourceStateKeyCount - Keys present in the prior snapshot.
 * @param {number} p.targetTokens - Slider target T (`getLayer0SummaryTokenTarget`).
 * @returns {string} Prompt block text (no trailing newline).
 */
export function buildLayer0BudgetHint({ sourceStateTokens, sourceStateKeyCount, targetTokens }) {
    const sentenceCap = computeSentenceCap('l0', targetTokens);

    const hasState = Number(sourceStateTokens) > 0;
    const stateLineCap = hasState ? computeStateLineCap(sourceStateKeyCount) : STATE_KEY_CEILING;

    const existingStateLine = hasState
        ? `Existing [STATE]: ${sourceStateKeyCount} keys.`
        : 'No existing [STATE] yet — build the first snapshot.';

    return [
        '<summaryception_source_budget>',
        'Compress the source passage hard.',
        buildSizeTargetLine({
            label: '[NARRATIVE]',
            verb: 'write',
            cap: sentenceCap,
            unit: 'sentences',
        }),
        existingStateLine,
        buildSizeTargetLine({
            label: '[STATE]',
            verb: 'rewrite the full snapshot;',
            cap: stateLineCap,
            unit: 'lines',
        }),
        '</summaryception_source_budget>',
    ].join('\n');
}
