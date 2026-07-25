import { describe, it, expect } from 'vitest';
import {
    buildLayer0SizeRepairFeedback,
    getLayer0SummaryTokenBounds,
    getLayer0SummaryRepairCeiling,
    getLayer0SummaryTokenTarget,
    isLayer0SizeGuardCall,
    isLayer0CompressionCall,
    appendLayer0PromptConstraints,
} from '../src/core/layer0-compression.js';
import {
    DEFAULT_SUMMARIZER_USER_PROMPT,
    DEFAULT_PROMOTION_USER_PROMPT,
} from '../src/foundation/prompt-constants.js';
import { EXECUTION_TRIGGER_L0, EXECUTION_TRIGGER_PROMO } from '../src/core/prompt-parts.js';
import { buildRepairDiagnostics } from '../src/core/repair-diagnostics.js';
import { defaultSettings } from '../src/foundation/constants.js';

describe('getLayer0SummaryTokenTarget', () => {
    it('returns the configured target clamped to bounds', () => {
        expect(getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: 200 })).toBe(200);
        expect(getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: 10 })).toBe(80);
        expect(getLayer0SummaryTokenTarget({ layer0SummaryTokenTarget: 99999 })).toBe(500);
    });

    it('falls back to the default when missing', () => {
        expect(getLayer0SummaryTokenTarget({})).toBe(defaultSettings.layer0SummaryTokenTarget);
    });
});

describe('getLayer0SummaryTokenBounds', () => {
    it('derives the accepted output range from the configured target', () => {
        expect(getLayer0SummaryTokenBounds({ layer0SummaryTokenTarget: 200 })).toEqual({
            target: 200,
            min: 80,
            max: 300,
        });
    });
});

describe('getLayer0SummaryRepairCeiling', () => {
    it('allows only a narrow narrative grace above the model-facing maximum', () => {
        expect(getLayer0SummaryRepairCeiling({ layer0SummaryTokenTarget: 200 })).toBe(330);
    });
});

describe('isLayer0CompressionCall', () => {
    it('returns true for layer0, regenerate, and promotion', () => {
        expect(isLayer0CompressionCall({ kind: 'layer0' })).toBe(true);
        expect(isLayer0CompressionCall({ kind: 'regenerate' })).toBe(true);
        expect(isLayer0CompressionCall({ kind: 'promotion' })).toBe(true);
    });

    it('returns false for unknown kinds', () => {
        expect(isLayer0CompressionCall({ kind: 'other' })).toBe(false);
        expect(isLayer0CompressionCall({})).toBe(false);
    });
});

describe('isLayer0SizeGuardCall', () => {
    it('returns true only for Layer 0 summary outputs', () => {
        expect(isLayer0SizeGuardCall({ kind: 'layer0' })).toBe(true);
        expect(isLayer0SizeGuardCall({ kind: 'regenerate' })).toBe(true);
        expect(isLayer0SizeGuardCall({ kind: 'promotion' })).toBe(false);
        expect(isLayer0SizeGuardCall({})).toBe(false);
    });
});

describe('buildLayer0SizeRepairFeedback', () => {
    it('includes rejected sections, absolute limits, and passing-section preservation', () => {
        const diagnostics = buildRepairDiagnostics({
            scope: 'Layer 0',
            totalTokens: 410,
            sections: [
                {
                    id: 'narrative',
                    label: '[NARRATIVE]',
                    actualTokens: 400,
                    targetTokens: 200,
                    hardMaxTokens: 300,
                    text: 'Rejected verbose narrative.',
                },
                {
                    id: 'state',
                    label: '[STATE]',
                    actualTokens: 10,
                    targetTokens: 200,
                    hardMaxTokens: 300,
                    text: 'current_date_time: 2026-07-15 17 Wed',
                    preservationInstruction: 'keep accepted state exactly',
                },
            ],
            rejectedDraft: 'draft',
        });
        const result = buildLayer0SizeRepairFeedback({
            diagnostics,
        });

        expect(result).toContain('summaryception_l0_repair_feedback');
        expect(result).toContain('[NARRATIVE]: rejected.');
        expect(result).not.toContain('400 tokens');
        expect(result).not.toContain('target 200');
        expect(result).toContain('<rejected_narrative>');
        expect(result).toContain('Rejected verbose narrative.');
        expect(result).toContain('Preserve [STATE] unchanged');
        expect(result).toContain('<preserve_state>');
    });
});

describe('appendLayer0PromptConstraints', () => {
    it('appends constraints for layer0 calls', () => {
        const result = appendLayer0PromptConstraints(
            'prompt',
            { layer0SummaryTokenTarget: 200 },
            {
                kind: 'layer0',
                sourceRange: [12, 34],
                budgetHint:
                    '<summaryception_source_budget>\nCompress the source passage hard.\n[NARRATIVE]: write at most 8 sentences.\nNo existing [STATE] yet — build the first snapshot.\n[STATE]: rewrite the full snapshot; at most 7 lines.\n</summaryception_source_budget>',
            },
        );
        expect(result).toContain('This passage covers chat messages 12-34');
        expect(result).toContain('Message 34 is the latest summarized message');
        expect(result).toContain('<summaryception_source_budget>');
        expect(result).toContain('write at most 8 sentences.');
        expect(result).toContain('at most 7 lines.');
        expect(result).not.toContain('aim ~');
        expect(result).not.toContain('never exceed');
    });

    it('appends narrative-only constraints for promotion calls', () => {
        const result = appendLayer0PromptConstraints(
            'prompt',
            {},
            {
                kind: 'promotion',
                layerIndex: 0,
                memoryTokensBefore: 1000,
            },
        );
        expect(result).toContain('summaryception_promotion_constraints');
        // layerIndex 0 produces L1: floor(1.75 * 200 * 0.75 / 30) === 8.
        expect(result).toContain('[NARRATIVE]: merge into at most 8 sentences.');
        expect(result).not.toContain('aim ~');
        expect(result).not.toContain('never exceed');
        expect(result).not.toContain('Source narratives');
        expect(result).not.toContain('deep-layer fold');
        expect(result).not.toContain('2024-07-12 Fri');
    });

    it('tightens the cap and adds the fold reminder for deep-layer promotions', () => {
        const result = appendLayer0PromptConstraints(
            'prompt',
            {},
            {
                kind: 'promotion',
                layerIndex: 1,
                memoryTokensBefore: 1000,
            },
        );
        // layerIndex >= 1 produces L2+: floor(1.5 * 200 * 0.65 / 30) === 6.
        expect(result).toContain('[NARRATIVE]: merge into at most 6 sentences.');
        expect(result).toContain('deep-layer fold');
        expect(result).not.toContain('token');
    });

    it('appends repair feedback for promotion repair calls', () => {
        const result = appendLayer0PromptConstraints(
            'prompt',
            {},
            {
                kind: 'promotion',
                layerIndex: 0,
                memoryTokensBefore: 1000,
                promotionRepair: {
                    reason: 'compression-ratio',
                    outputTokens: 700,
                    targetTokens: 80,
                    hardMaxTokens: 350,
                    rejectedSummary:
                        'One beat. Two beat. Three beat. Four beat. Five beat. Six beat. Seven beat. Eight beat. Nine beat. Ten beat.',
                },
            },
        );
        expect(result).toContain('Repair task');
        expect(result).toContain('previous Layer 1+ promotion draft failed');
        // Sentence-delta repair: 10 sentences against a cap of 8.
        expect(result).toContain('Draft contained 10 sentences; the limit is 8.');
        expect(result).toContain('Delete at least 2 sentences.');
        expect(result).toContain('[NARRATIVE]: rejected.');
        expect(result).toContain('<rejected_promotion_draft>');
        expect(result).toContain('Ten beat.');
        expect(result).not.toContain('700 tokens');
        expect(result).not.toContain('target 80');
    });

    it('appends over-merge repair feedback for too-short promotion repairs', () => {
        const result = appendLayer0PromptConstraints(
            'prompt',
            {},
            {
                kind: 'promotion',
                layerIndex: 0,
                memoryTokensBefore: 1000,
                promotionRepair: {
                    reason: 'too-short',
                    outputTokens: 40,
                    targetTokens: 80,
                    hardMaxTokens: 350,
                    rejectedSummary: 'The trio moved on.',
                },
            },
        );
        expect(result).toContain('over-merged');
        expect(result).toContain('Expand the fold.');
        expect(result).toContain('restore the dropped durable beats');
        expect(result).toContain('<rejected_promotion_draft>');
        expect(result).not.toContain('Delete at least');
    });

    it('returns prompt unchanged for non-compression calls', () => {
        const result = appendLayer0PromptConstraints('prompt', {}, { kind: 'other' });
        expect(result).toBe('prompt');
    });
});

describe('appendLayer0PromptConstraints trigger-last ordering', () => {
    const substitutePlaceholders = (template) =>
        template
            .replace('{{player_name}}', 'Alice')
            .replace('{{context_str}}', '(none yet)')
            .replace('{{story_txt}}', 'Some passage text.')
            .replace('{{source_state}}', 'none');

    it('places the L0 trigger after the budget hint and source-range line', () => {
        const prompt = substitutePlaceholders(DEFAULT_SUMMARIZER_USER_PROMPT);
        const result = appendLayer0PromptConstraints(
            prompt,
            { layer0SummaryTokenTarget: 200 },
            {
                kind: 'layer0',
                sourceRange: [12, 34],
                budgetHint:
                    '<summaryception_source_budget>\nCompress the source passage hard.\n[NARRATIVE]: write at most 8 sentences.\n</summaryception_source_budget>',
            },
        );

        expect(result.endsWith(EXECUTION_TRIGGER_L0)).toBe(true);
        expect(result.indexOf('<summaryception_source_budget>')).toBeLessThan(
            result.indexOf(EXECUTION_TRIGGER_L0),
        );
        expect(result.indexOf('This passage covers chat messages 12-34')).toBeLessThan(
            result.indexOf(EXECUTION_TRIGGER_L0),
        );
    });

    it('places the promotion trigger after the promotion constraints block', () => {
        const prompt = substitutePlaceholders(DEFAULT_PROMOTION_USER_PROMPT);
        const result = appendLayer0PromptConstraints(
            prompt,
            {},
            {
                kind: 'promotion',
                memoryTokensBefore: 1000,
            },
        );

        expect(result.endsWith(EXECUTION_TRIGGER_PROMO)).toBe(true);
        expect(result.indexOf('summaryception_promotion_constraints')).toBeLessThan(
            result.indexOf(EXECUTION_TRIGGER_PROMO),
        );
    });
});
