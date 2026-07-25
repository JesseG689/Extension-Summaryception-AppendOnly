import { describe, it, expect } from 'vitest';

import {
    computeSentenceCap,
    computeStateLineCap,
    STATE_KEY_CEILING,
    TOKENS_PER_SENTENCE,
    LAYER_MIN_RATIO,
    LAYER_HARD_MAX_RATIO,
    LAYER0_REPAIR_RATIO,
    LAYER_SAFETY_MULTIPLIER,
} from '../src/core/token-budget/structural-constraints.js';
import { buildLayer0BudgetHint } from '../src/core/token-budget/budget-hint-builder.js';
import { buildStructuralRepairFeedback } from '../src/core/token-budget/repair-feedback-adapter.js';

describe('computeStateLineCap', () => {
    it('clamps to the ceiling of 7', () => {
        expect(computeStateLineCap(9)).toBe(7);
    });

    it('returns the count when below the ceiling', () => {
        expect(computeStateLineCap(3)).toBe(3);
    });

    it('falls back to the ceiling when the count is absent or invalid', () => {
        expect(computeStateLineCap(0)).toBe(7);
        expect(computeStateLineCap(undefined)).toBe(7);
        expect(computeStateLineCap(NaN)).toBe(7);
        expect(computeStateLineCap(-2)).toBe(7);
    });

    it('exposes the ceiling constant', () => {
        expect(STATE_KEY_CEILING).toBe(7);
    });
});

describe('computeSentenceCap', () => {
    it('matches the reference matrix at the default slider target of 200', () => {
        expect(computeSentenceCap('l0', 200)).toBe(8);
        expect(computeSentenceCap('l1', 200)).toBe(8);
        expect(computeSentenceCap('l2', 200)).toBe(6);
    });

    it('treats a numeric layer as a direct/promotion source layer', () => {
        expect(computeSentenceCap(0, 200)).toBe(8);
        expect(computeSentenceCap(1, 200)).toBe(6);
        expect(computeSentenceCap(4, 200)).toBe(6);
    });

    it('scales with the slider target', () => {
        // floor(1.5 * 500 * 0.85 / 30) === 21
        expect(computeSentenceCap('l0', 500)).toBe(21);
        // floor(1.75 * 500 * 0.75 / 30) === 21
        expect(computeSentenceCap('l1', 500)).toBe(21);
        // floor(1.5 * 500 * 0.65 / 30) === 16
        expect(computeSentenceCap('l2', 500)).toBe(16);
    });

    it('floors at 1 for invalid or non-positive targets', () => {
        expect(computeSentenceCap('l0', 0)).toBe(1);
        expect(computeSentenceCap('l0', -5)).toBe(1);
        expect(computeSentenceCap('l2', NaN)).toBe(1);
        expect(computeSentenceCap('l1', undefined)).toBe(1);
    });

    it('exposes the load-bearing band constants', () => {
        expect(TOKENS_PER_SENTENCE).toBe(30);
        expect(LAYER_MIN_RATIO).toEqual({ l0: 0.4, l1: 0.4, l2: 0.3 });
        expect(LAYER_HARD_MAX_RATIO).toEqual({ l0: 1.5, l1: 1.75, l2: 1.5 });
        expect(LAYER0_REPAIR_RATIO).toBe(1.65);
        expect(LAYER_SAFETY_MULTIPLIER).toEqual({ l0: 0.85, l1: 0.75, l2: 0.65 });
    });
});

describe('buildLayer0BudgetHint', () => {
    it('emits only countable caps anchored to the slider target, with no token figures', () => {
        const hint = buildLayer0BudgetHint({
            sourceStateTokens: 120,
            sourceStateKeyCount: 5,
            targetTokens: 200,
        });

        expect(hint).toContain('<summaryception_source_budget>');
        // Sentence cap: floor(1.5 * 200 * 0.85 / 30) === 8.
        expect(hint).toContain('[NARRATIVE]: write at most 8 sentences.');
        // State key count present, line cap is min(5, 7) === 5.
        expect(hint).toContain('Existing [STATE]: 5 keys.');
        expect(hint).toContain('[STATE]: rewrite the full snapshot; at most 5 lines.');
        // No token arithmetic reaches the model.
        expect(hint).not.toContain('token');
        expect(hint).not.toContain('aim ~');
        expect(hint).not.toContain('never exceed');
    });

    it('switches to the first-snapshot variant and the ceiling line cap when there is no prior [STATE]', () => {
        const hint = buildLayer0BudgetHint({
            sourceStateTokens: 0,
            sourceStateKeyCount: 0,
            targetTokens: 200,
        });

        expect(hint).toContain('No existing [STATE] yet — build the first snapshot.');
        expect(hint).toContain('at most 7 lines.');
        expect(hint).not.toContain('Existing [STATE]:');
    });

    it('scales the sentence cap with the slider target', () => {
        const hint = buildLayer0BudgetHint({
            sourceStateTokens: 0,
            sourceStateKeyCount: 0,
            targetTokens: 120,
        });
        // floor(1.5 * 120 * 0.85 / 30) === 5.
        expect(hint).toContain('[NARRATIVE]: write at most 5 sentences.');
    });

    it('returns no trailing newline', () => {
        const hint = buildLayer0BudgetHint({
            sourceStateTokens: 120,
            sourceStateKeyCount: 5,
            targetTokens: 200,
        });
        expect(hint.endsWith('\n')).toBe(false);
    });
});

describe('buildStructuralRepairFeedback', () => {
    function stateDiagnostics(text) {
        return {
            violations: [
                {
                    id: 'state',
                    label: '[STATE]',
                    reason: 'above-hard-maximum',
                    text,
                },
            ],
        };
    }

    function narrativeDiagnostics(text) {
        return {
            violations: [
                {
                    id: 'narrative',
                    label: '[NARRATIVE]',
                    reason: 'above-hard-maximum',
                    text,
                },
            ],
        };
    }

    it('emits a STATE line-count structural feedback when over the cap', () => {
        const stateText = Array.from({ length: 9 }, (_v, i) => `key${i}: val${i}`).join('\n');
        const feedback = buildStructuralRepairFeedback(stateDiagnostics(stateText), {
            sourceStateKeyCount: 9,
        });
        expect(feedback).toContain('maximum 7');
        expect(feedback).toContain('Remove the 2 least-durable keys.');
    });

    it('emits a NARRATIVE sentence-count structural feedback when over the cap', () => {
        const narrative = 'One. Two. Three. Four. Five. Six. Seven. Eight. Nine.';
        const feedback = buildStructuralRepairFeedback(narrativeDiagnostics(narrative), {
            targetTokens: 200,
            layer: 'l0',
        });
        // Cap is 8 at T=200; 9 sentences means one must go.
        expect(feedback).toContain('maximum 8');
        expect(feedback).toContain('Merge or drop the 1 least-important.');
    });

    it('returns an empty string when there are no violations', () => {
        expect(buildStructuralRepairFeedback({ violations: [] }, {})).toBe('');
    });

    it('returns an empty string when the violating section is at or below the cap', () => {
        const stateText = 'a: 1\nb: 2';
        const feedback = buildStructuralRepairFeedback(stateDiagnostics(stateText), {
            sourceStateKeyCount: 7,
        });
        expect(feedback).toBe('');
    });

    it('ignores below-minimum violations', () => {
        const diagnostics = {
            violations: [
                {
                    id: 'narrative',
                    label: '[NARRATIVE]',
                    reason: 'below-minimum',
                    text: 'Short.',
                },
            ],
        };
        expect(buildStructuralRepairFeedback(diagnostics, { targetTokens: 200 })).toBe('');
    });
});
