import { describe, expect, it } from 'vitest';

import { getCacheFriendlyPlan, getProtectedTailTokens } from '../src/core/cache-planner.js';
import {
    installSummaryContext,
    makeMessage,
    makeSizedChat,
    makeSummarySettings,
    makeSummaryStore,
    messageLineTokens,
} from './test-helpers.js';

describe('getProtectedTailTokens', () => {
    it('clamps to a monotonic 1000-aligned band without exposing internal bounds', () => {
        installSummaryContext();
        const low = getProtectedTailTokens(5000);
        const floor = getProtectedTailTokens(0);
        const mid = getProtectedTailTokens(20000);
        const high = getProtectedTailTokens(30000);
        const top = getProtectedTailTokens(100000);

        expect(low).toBe(getProtectedTailTokens(10000));
        expect(low).toBe(floor);
        expect(mid).toBeLessThan(high);
        expect(top).toBe(getProtectedTailTokens(200000));
        expect(top).toBeGreaterThan(high);
        for (const value of [low, floor, mid, high, top]) {
            expect(value % 1000).toBe(0);
        }
        expect(getProtectedTailTokens(Number.NaN)).toBe(floor);
        expect(getProtectedTailTokens(undefined)).toBe(floor);
    });
});

describe('getCacheFriendlyPlan', () => {
    it('stays idle when the latest visible message is not an assistant turn', async () => {
        installSummaryContext();
        const chat = [
            ...makeSizedChat(2, { userLength: 4000, assistantLength: 4000 }),
            makeMessage({ isUser: true, mes: 'x'.repeat(4000) }),
        ];
        const settings = makeSummarySettings({ verbatimTokenBudget: 1000 });

        const plan = await getCacheFriendlyPlan(chat, makeSummaryStore(), settings);

        expect(plan.reason).toBe('none');
        expect(plan.batchTurns).toEqual([]);
        expect(plan.partitions).toEqual([]);
        expect(plan.assistantTurns).toEqual([]);
        expect(plan.flushEndIdx).toBe(-1);
        expect(plan.tokenBudgetExceeded).toBe(true);
        expect(plan.liveTokens).toBeGreaterThan(1000);
    });

    it('stays idle while the live window fits the verbatim budget', async () => {
        installSummaryContext();
        const chat = makeSizedChat(2, { userLength: 50, assistantLength: 50 });
        const settings = makeSummarySettings({ verbatimTokenBudget: 16000 });

        const plan = await getCacheFriendlyPlan(chat, makeSummaryStore(), settings);

        expect(plan.reason).toBe('none');
        expect(plan.tokenBudgetExceeded).toBe(false);
        expect(plan.liveTokens).toBe(
            2 * messageLineTokens(true, 50) + 2 * messageLineTokens(false, 50),
        );
    });

    it('flushes oldest-first while protecting a stable recent tail', async () => {
        installSummaryContext();
        const chat = makeSizedChat(6, { userLength: 500, assistantLength: 2000 });
        const settings = makeSummarySettings({
            verbatimTokenBudget: 6000,
            minSummaryBudget: 6000,
            maxL0SourceTokens: 24000,
        });

        const plan = await getCacheFriendlyPlan(chat, makeSummaryStore(), settings);

        expect(plan.reason).toBe('ready');
        expect(plan.flushStartIdx).toBe(0);
        expect(plan.tailStartIdx).toBe(9);
        expect(plan.flushEndIdx).toBe(7);
        expect(plan.assistantTurns.map((turn) => turn.index)).toEqual([1, 3, 5, 7]);
        expect(plan.batchTurns).toBe(plan.partitions[0].turns);
        expect(plan.partitions.length).toBe(2);
        expect(plan.partitions[0].sourceStartIdx).toBe(0);
        expect(plan.partitions[0].sourceEndIdx).toBe(3);
        expect(plan.partitions[1].sourceStartIdx).toBe(4);
        expect(plan.partitions[1].sourceEndIdx).toBe(7);
        expect(plan.partitions[1].sourceStartIdx).toBe(plan.partitions[0].sourceEndIdx + 1);
        for (const partition of plan.partitions) {
            expect(partition.sourceEndIdx).toBe(partition.turns[partition.turns.length - 1].index);
        }
        expect(plan.liveTokens).toBe(
            6 * messageLineTokens(true, 500) + 6 * messageLineTokens(false, 2000),
        );
        expect(plan.tokenBudgetExceeded).toBe(true);
    });

    it('stays idle when the protected tail absorbs the whole live region', async () => {
        installSummaryContext();
        const chat = [
            makeMessage({ isUser: true, mes: 'x'.repeat(10) }),
            makeMessage({ mes: 'x'.repeat(5000) }),
        ];
        const settings = makeSummarySettings({ verbatimTokenBudget: 4000 });

        const plan = await getCacheFriendlyPlan(chat, makeSummaryStore(), settings);

        expect(plan.reason).toBe('none');
        expect(plan.tailStartIdx).toBe(1);
        expect(plan.assistantTurns).toEqual([]);
    });

    it('offsets the flush start by summarizedUpTo', async () => {
        installSummaryContext();
        const chat = makeSizedChat(6, { userLength: 500, assistantLength: 2000 });
        const settings = makeSummarySettings({
            verbatimTokenBudget: 6000,
            minSummaryBudget: 6000,
            maxL0SourceTokens: 24000,
        });
        const store = makeSummaryStore({ summarizedUpTo: 3 });

        const plan = await getCacheFriendlyPlan(chat, store, settings);

        expect(plan.reason).toBe('ready');
        expect(plan.flushStartIdx).toBe(4);
        expect(plan.tailStartIdx).toBe(9);
        expect(plan.flushEndIdx).toBe(7);
        expect(plan.assistantTurns.map((turn) => turn.index)).toEqual([5, 7]);
        expect(plan.partitions.length).toBe(1);
        expect(plan.partitions[0].sourceStartIdx).toBe(4);
        expect(plan.partitions[0].sourceEndIdx).toBe(7);
    });

    it('ignores hidden, system, and ghosted messages in the cache window', async () => {
        installSummaryContext();
        const chat = [
            ...makeSizedChat(6, { userLength: 500, assistantLength: 2000 }),
            makeMessage({ mes: 'x'.repeat(2000), isHidden: true }),
            makeMessage({ mes: 'x'.repeat(2000), isSystem: true }),
            makeMessage({ mes: 'x'.repeat(2000), ghosted: true }),
        ];
        const settings = makeSummarySettings({
            verbatimTokenBudget: 6000,
            minSummaryBudget: 6000,
            maxL0SourceTokens: 24000,
        });

        const plan = await getCacheFriendlyPlan(chat, makeSummaryStore(), settings);

        expect(plan.reason).toBe('ready');
        expect(plan.liveTokens).toBe(
            6 * messageLineTokens(true, 500) + 6 * messageLineTokens(false, 2000),
        );
        expect(plan.tailStartIdx).toBe(9);
        expect(plan.flushEndIdx).toBe(7);
    });

    it('excludes baked WI from the live cache window', async () => {
        installSummaryContext();
        const chat = makeSizedChat(2, { userLength: 50, assistantLength: 50 });
        const baked = makeMessage({ mes: 'x'.repeat(1000) });
        baked.extra.sc_wi = { uids: [1], version: 1 };
        chat.splice(2, 0, baked);

        const plan = await getCacheFriendlyPlan(
            chat,
            makeSummaryStore(),
            makeSummarySettings({ verbatimTokenBudget: 16000 }),
        );

        expect(plan.liveTokens).toBe(
            2 * messageLineTokens(true, 50) + 2 * messageLineTokens(false, 50),
        );
    });
});
