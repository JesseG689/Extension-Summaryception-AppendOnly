import { defaultSettings } from '../foundation/constants.js';
import {
    STATE_SNAPSHOT_MAX_TOKENS,
    STATE_SNAPSHOT_SOFT_TARGET_TOKENS,
} from '../foundation/prompt-constants.js';
import { buildRepairDiagnostics, formatRepairDiagnostics } from './repair-diagnostics.js';
import { applySafetyGap } from './token-budget/safety-gap.js';
import {
    buildSizeConstraintsBlock,
    buildSizeTargetLine,
} from './token-budget/budget-hint-builder.js';

const MIN_LAYER0_TARGET_TOKENS = 80;
const MAX_LAYER0_TARGET_TOKENS = 500;
const LAYER0_MIN_OUTPUT_RATIO = 1 / 3;
const LAYER0_MAX_OUTPUT_RATIO = 1.5;
const LAYER0_REPAIR_MAX_OUTPUT_RATIO = 1.65;
const PROMOTION_TARGET_RATIO = 0.4;
const PROMOTION_HARD_MAX_RATIO = 0.6;

/**
 * Check whether a summarizer call should receive runtime compression controls.
 * @param {import('./summarizer-usage.js').SummarizerCallMetadata} [metadata]
 * @returns {boolean}
 */
export function isLayer0CompressionCall(metadata = {}) {
    return (
        metadata.kind === 'layer0' ||
        metadata.kind === 'regenerate' ||
        metadata.kind === 'promotion'
    );
}

/**
 * Normalize the configured Layer 0 summary target.
 * @param {Partial<ExtensionSettings>} [settings]
 * @returns {number}
 */
export function getLayer0SummaryTokenTarget(settings = {}) {
    const parsed = Number(settings.layer0SummaryTokenTarget);
    const fallback = defaultSettings.layer0SummaryTokenTarget;
    const value = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
    return Math.min(MAX_LAYER0_TARGET_TOKENS, Math.max(MIN_LAYER0_TARGET_TOKENS, value));
}

/**
 * Compute the accepted Layer 0 output-size band for a configured target.
 * @param {Partial<ExtensionSettings>} [settings]
 * @returns {{ target: number, min: number, max: number }}
 */
export function getLayer0SummaryTokenBounds(settings = {}) {
    const target = getLayer0SummaryTokenTarget(settings);
    return {
        target,
        min: Math.floor(target * LAYER0_MIN_OUTPUT_RATIO),
        max: Math.round(target * LAYER0_MAX_OUTPUT_RATIO),
    };
}

/**
 * Compute the narrow narrative grace ceiling used to avoid retrying near-miss
 * outputs from slow providers. The model-facing hard maximum remains the
 * normal Layer 0 bound.
 * @param {Partial<ExtensionSettings>} [settings]
 * @returns {number}
 */
export function getLayer0SummaryRepairCeiling(settings = {}) {
    return Math.round(getLayer0SummaryTokenTarget(settings) * LAYER0_REPAIR_MAX_OUTPUT_RATIO);
}

/**
 * Check whether a summarizer call should receive Layer 0 size validation.
 * @param {import('./summarizer-usage.js').SummarizerCallMetadata} [metadata]
 * @returns {boolean}
 */
export function isLayer0SizeGuardCall(metadata = {}) {
    return metadata.kind === 'layer0' || metadata.kind === 'regenerate';
}

/**
 * Build attempt-local repair feedback for a rejected Layer 0 output.
 * @param {object} p
 * @param {object} [p.diagnostics]
 * @param {'too-short' | 'too-long'} [p.reason]
 * @param {number} [p.outputTokens]
 * @param {{ target: number, min: number, max: number }} [p.bounds]
 * @returns {string}
 */
export function buildLayer0SizeRepairFeedback({ diagnostics, reason, outputTokens, bounds }) {
    const resolvedDiagnostics =
        diagnostics ||
        buildRepairDiagnostics({
            scope: 'Layer 0',
            totalTokens: outputTokens ?? 0,
            sections: [
                {
                    id: 'narrative',
                    label: '[NARRATIVE]',
                    actualTokens: outputTokens ?? 0,
                    targetTokens: bounds?.target ?? 0,
                    hardMaxTokens: bounds?.max ?? 0,
                    minimumTokens: reason === 'too-short' ? (bounds?.min ?? 0) : 0,
                },
            ],
        });
    return formatRepairDiagnostics(resolvedDiagnostics, {
        wrapperTag: 'summaryception_l0_repair_feedback',
        rejectedSectionTagPrefix: 'rejected_',
    }).replace(
        '</summaryception_l0_repair_feedback>',
        'Aim for each section soft target, not merely its hard maximum. Rewrite only the rejected section or sections. Reproduce every preserved section exactly.\n' +
            'Output exactly one [NARRATIVE] section followed by exactly one [STATE] section.\n' +
            '</summaryception_l0_repair_feedback>',
    );
}

/**
 * Build repair feedback for an oversized state snapshot.
 * @param {object} p
 * @param {number} p.stateTokens
 * @param {string} [p.stateText]
 * @returns {string}
 */
export function buildStateSnapshotSizeRepairFeedback({ stateTokens, stateText = '' }) {
    const diagnostics = buildRepairDiagnostics({
        scope: 'Layer 0',
        totalTokens: stateTokens,
        sections: [
            {
                id: 'state',
                label: '[STATE]',
                actualTokens: stateTokens,
                targetTokens: STATE_SNAPSHOT_SOFT_TARGET_TOKENS,
                hardMaxTokens: STATE_SNAPSHOT_MAX_TOKENS,
                text: stateText,
                repairInstruction:
                    'rewrite the complete snapshot more abstractly and remove transient facts',
                preservationInstruction:
                    'keep only the fixed state keys and the most consequential active continuity',
            },
        ],
        rejectedDraft: stateText,
    });
    return buildLayer0SizeRepairFeedback({ diagnostics });
}

/**
 * Add non-persisted compression constraints to the final prompt.
 * @param {string} prompt
 * @param {Partial<ExtensionSettings>} settings
 * @param {import('./summarizer-usage.js').SummarizerCallMetadata} [metadata]
 * @returns {string}
 */
export function appendLayer0PromptConstraints(prompt, settings, metadata = {}) {
    if (!isLayer0CompressionCall(metadata)) {
        return prompt;
    }

    if (metadata.kind === 'promotion') {
        return appendPromotionPromptConstraints(prompt, metadata);
    }

    const sourceRangeLine = buildLayer0SourceRangeLine(metadata);
    return (
        `${String(prompt || '').trimEnd()}\n\n` +
        (metadata.budgetHint ? metadata.budgetHint + '\n\n' : '') +
        sourceRangeLine
    ).trimEnd();
}

function buildLayer0SourceRangeLine(metadata = {}) {
    const range = metadata.sourceRange;
    if (!Array.isArray(range) || range.length < 2) {
        return '';
    }
    return (
        `This passage covers chat messages ${range[0]}-${range[1]}. ` +
        `Message ${range[1]} is the latest summarized message. ` +
        'current_date_time must be the scene time at the end of that message.\n'
    );
}

/**
 * Compute the target size for a Layer 1+ promotion from source memory size.
 * @param {import('./summarizer-usage.js').SummarizerCallMetadata} metadata
 * @returns {number|null}
 */
export function getPromotionSummaryTokenTarget(metadata = {}) {
    const sourceTokens = Number(metadata.memoryTokensBefore);
    if (!Number.isFinite(sourceTokens) || sourceTokens <= 0) {
        return null;
    }
    return Math.max(1, Math.round(sourceTokens * PROMOTION_TARGET_RATIO));
}

/**
 * Compute the hard maximum size for a Layer 1+ promotion.
 * @param {import('./summarizer-usage.js').SummarizerCallMetadata} metadata
 * @returns {number|null}
 */
export function getPromotionSummaryTokenHardMax(metadata = {}) {
    const sourceTokens = Number(metadata.memoryTokensBefore);
    if (!Number.isFinite(sourceTokens) || sourceTokens <= 0) {
        return null;
    }
    return Math.max(1, Math.floor(sourceTokens * PROMOTION_HARD_MAX_RATIO));
}

/**
 * Compute the model-facing soft target for a promotion. Mirrors the L0
 * `applySafetyGap` strategy: the prompt shows ~90% of the real validation
 * bound so a first attempt that lands near the model-facing number still
 * passes `validatePromotionCandidate`, which checks the RAW bound.
 * @param {import('./summarizer-usage.js').SummarizerCallMetadata} metadata
 * @returns {number|null}
 */
export function getPromotionPromptSoftTarget(metadata = {}) {
    const realTarget = getPromotionSummaryTokenTarget(metadata);
    return realTarget === null ? null : applySafetyGap(realTarget);
}

/**
 * Compute the model-facing hard maximum for a promotion. Gap-adjusted so the
 * model never sees the real ceiling; real validation uses the raw bound.
 * @param {import('./summarizer-usage.js').SummarizerCallMetadata} metadata
 * @returns {number|null}
 */
export function getPromotionPromptHardMax(metadata = {}) {
    const realHardMax = getPromotionSummaryTokenHardMax(metadata);
    return realHardMax === null ? null : applySafetyGap(realHardMax);
}
/**
 * Add Layer 1+ promotion-specific consolidation constraints.
 * @param {string} prompt
 * @param {import('./summarizer-usage.js').SummarizerCallMetadata} metadata
 * @returns {string}
 */
function appendPromotionPromptConstraints(prompt, metadata = {}) {
    const sourceTokens = Number(metadata.memoryTokensBefore);
    const promptTarget = getPromotionPromptSoftTarget(metadata);
    const promptHardMax = getPromotionPromptHardMax(metadata);
    const hasBounds = promptTarget !== null && promptHardMax !== null;

    const extra = hasBounds ? buildPromotionTargetExtra(metadata, sourceTokens) : '';
    const targetLine = hasBounds
        ? buildSizeTargetLine({
              label: '[NARRATIVE]',
              softTarget: promptTarget,
              hardMax: promptHardMax,
              extra,
          })
        : 'Target length: make the [NARRATIVE] output significantly shorter than the combined input memories.';
    const repairLine = buildPromotionRepairLine(metadata);

    return (
        `${String(prompt || '').trimEnd()}\n\n` +
        buildSizeConstraintsBlock({
            wrapperTag: 'summaryception_promotion_constraints',
            targetLine,
            repairLine,
        })
    );
}

/**
 * Build the trailing clause of the promotion target line. The static LENGTH
 * CONTRACT states the 40%/60% ratios in prose; this appends the concrete
 * source size and an L1+-specific "compress-harder" reminder so the model
 * sees the numeric bar it must beat, not just a ratio.
 * @param {object} metadata
 * @param {number} sourceTokens
 * @returns {string}
 */
function buildPromotionTargetExtra(metadata, sourceTokens) {
    const sourceTokensClause = `Source narratives: ~${Math.round(sourceTokens)} tokens.`;
    const deepReminder =
        Number(metadata.layerIndex) >= 1
            ? ' This is a deep-layer fold: merge whole scenes into outcome sentences; do not replay beats.'
            : '';
    return `${sourceTokensClause}${deepReminder} [NARRATIVE] output only.`;
}

function buildPromotionRepairLine(metadata = {}) {
    if (!metadata.promotionRepair) {
        return '';
    }

    const repair = metadata.promotionRepair;
    const outputTokens = Number(repair.outputTokens);
    const targetTokens = Number(repair.targetTokens);
    const hardMaxTokens = Number(repair.hardMaxTokens ?? repair.requiredMaxTokens);
    const rejected = String(repair.rejectedSummary || '').trim();
    const diagnostics =
        repair.diagnostics ||
        buildRepairDiagnostics({
            scope: 'Layer 1+ promotion',
            totalTokens: outputTokens,
            sections: [
                {
                    id: 'draft',
                    label: '[NARRATIVE]',
                    actualTokens: outputTokens,
                    targetTokens,
                    hardMaxTokens,
                    text: rejected,
                    repairInstruction:
                        'rewrite as macro-level prose only; remove dialogue, scene replay, micro-actions, and transient detail',
                    preservationInstruction:
                        'retain only macro-level durable chronology and continuity',
                },
            ],
            rejectedDraft: rejected,
        });
    const feedback = formatRepairDiagnostics(diagnostics, {
        wrapperTag: 'summaryception_promotion_repair_feedback',
        rejectedSectionTagPrefix: 'rejected_promotion_',
    });

    const overMsg =
        Number.isFinite(outputTokens) &&
        Number.isFinite(hardMaxTokens) &&
        outputTokens > hardMaxTokens
            ? `Previous draft was ${outputTokens} tokens; the real ceiling is ${hardMaxTokens} and the aim is ${targetTokens}. Delete at least ${outputTokens - hardMaxTokens} tokens of scene replay.`
            : '';
    return (
        'Repair task: rewrite the rejected narrative toward the soft target, not merely below the hard maximum.\n' +
        (overMsg ? overMsg + '\n' : '') +
        'Keep only macro-level durable chronology, current position, relationship/state changes, permanent rules, and unresolved hooks.\n' +
        feedback +
        '\n'
    );
}
