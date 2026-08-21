import { describe, expect, it } from 'vitest';

import { MEMORY_MODES } from '../src/foundation/constants.js';
import { buildMainContextPreviewModel, buildTriggerGaugeModel } from '../src/entry/ui.js';

describe('A/B/C UI models', () => {
    it('includes C only in the Append Only main-request range', () => {
        const base = {
            memoryTokenBudget: 10000,
            verbatimTokenBudget: 16000,
            queuedTokenBudget: 32000,
            bakedWorldInfoTokenBudget: 10000,
        };
        expect(
            buildMainContextPreviewModel({ ...base, memoryMode: MEMORY_MODES.APPEND_ONLY }),
        ).toEqual({
            rawChatMin: 16000,
            rawChatMax: 48000,
            mainMin: 26000,
            mainMax: 68000,
            bakedWorldInfoMax: 10000,
        });
        expect(
            buildMainContextPreviewModel({ ...base, memoryMode: MEMORY_MODES.BALANCED }),
        ).toEqual({
            rawChatMin: 16000,
            rawChatMax: 48000,
            mainMin: 26000,
            mainMax: 58000,
            bakedWorldInfoMax: 0,
        });
    });

    it('builds the B gauge from queued planner stats and the B budget', () => {
        expect(
            buildTriggerGaugeModel(
                {
                    rawPlan: { queuedStats: { finalTokens: 4321.2, finalTokensEstimated: true } },
                },
                { queuedTokenBudget: 16000 },
            ),
        ).toEqual({
            queuedTokens: 4322,
            queuedEstimated: true,
            triggerTokens: 16000,
            label: 'Summarize at A + B',
        });
    });
});
