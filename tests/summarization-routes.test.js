import { describe, expect, it } from 'vitest';

import {
    SUMMARY_COMMIT_MODES,
    SUMMARY_ROUTES,
    buildAutoSummaryRoutePlan,
    buildForceSummaryRoutePlan,
} from '../src/core/summarization-routes.js';
import { MEMORY_MODES } from '../src/foundation/constants.js';
import {
    installSummaryContext,
    makeMessages,
    makeSizedChat,
    makeSummarySettings,
    makeSummaryStore,
} from './test-helpers.js';

describe('buildAutoSummaryRoutePlan', () => {
    it('dispatches a ready cache route with atomic partition commits', async () => {
        installSummaryContext();
        const chat = makeSizedChat(6, { userLength: 500, assistantLength: 2000 });
        const settings = makeSummarySettings({
            memoryMode: MEMORY_MODES.CACHE,
            verbatimTokenBudget: 6000,
            minSummaryBudget: 6000,
            maxL0SourceTokens: 24000,
        });

        const plan = await buildAutoSummaryRoutePlan(chat, makeSummaryStore(), settings);

        expect(plan.route).toBe(SUMMARY_ROUTES.CACHE_AUTO);
        expect(plan.ready).toBe(true);
        expect(plan.commitMode).toBe(SUMMARY_COMMIT_MODES.ATOMIC_PARTITIONS);
        expect(plan.phase).toBe('layer0');
        expect(plan.reason).toBe('ready');
        expect(plan.partitions.length).toBe(2);
        expect(plan.totalBatches).toBe(plan.partitions.length);
        expect(plan.batchTurns.length).toBe(2);
    });

    it('dispatches an idle cache route when the live window fits the budget', async () => {
        installSummaryContext();
        const chat = makeSizedChat(2, { userLength: 50, assistantLength: 50 });
        const settings = makeSummarySettings({
            memoryMode: MEMORY_MODES.CACHE,
            verbatimTokenBudget: 16000,
        });

        const plan = await buildAutoSummaryRoutePlan(chat, makeSummaryStore(), settings);

        expect(plan.route).toBe(SUMMARY_ROUTES.CACHE_AUTO);
        expect(plan.ready).toBe(false);
        expect(plan.totalBatches).toBe(0);
        expect(plan.partitions).toEqual([]);
    });

    it('dispatches the standard route on the budget branch with turn commits', async () => {
        installSummaryContext();
        const chat = makeSizedChat(3, { userLength: 500, assistantLength: 2000 });
        const settings = makeSummarySettings({
            memoryMode: MEMORY_MODES.STANDARD,
            verbatimTokenBudget: 4000,
            minSummaryBudget: 5000,
            maxL0SourceTokens: 24000,
            minSummaryTurns: 2,
            maxSummaryTurns: 5,
        });

        const plan = await buildAutoSummaryRoutePlan(chat, makeSummaryStore(), settings);

        expect(plan.route).toBe(SUMMARY_ROUTES.STANDARD_AUTO);
        expect(plan.commitMode).toBe(SUMMARY_COMMIT_MODES.TURNS);
        expect(plan.reason).toBe('budget');
        expect(plan.ready).toBe(true);
        expect(plan.totalBatches).toBe(1);
        expect(plan.batchTurns.map((turn) => turn.index)).toEqual([1, 3]);
    });

    it('dispatches the standard route on the max-turns branch', async () => {
        installSummaryContext();
        const chat = makeSizedChat(5, { userLength: 500, assistantLength: 2000 });
        const settings = makeSummarySettings({
            verbatimTokenBudget: 1000,
            minSummaryBudget: 6000,
            maxL0SourceTokens: 24000,
            minSummaryTurns: 2,
            maxSummaryTurns: 3,
        });

        const plan = await buildAutoSummaryRoutePlan(chat, makeSummaryStore(), settings);

        expect(plan.route).toBe(SUMMARY_ROUTES.STANDARD_AUTO);
        expect(plan.reason).toBe('max');
        expect(plan.ready).toBe(true);
        expect(plan.batchTurns.map((turn) => turn.index)).toEqual([1, 3]);
    });

    it('dispatches the standard repair branch with no batch turns for a user-only overflow', async () => {
        installSummaryContext();
        const chat = makeMessages(3, { isUser: true, mes: 'x'.repeat(2000) });
        const settings = makeSummarySettings({ verbatimTokenBudget: 4000 });

        const plan = await buildAutoSummaryRoutePlan(chat, makeSummaryStore(), settings);

        expect(plan.route).toBe(SUMMARY_ROUTES.STANDARD_AUTO);
        expect(plan.reason).toBe('repair');
        expect(plan.ready).toBe(true);
        expect(plan.batchTurns).toEqual([]);
    });
});

describe('buildForceSummaryRoutePlan', () => {
    it('overrides readiness gates and commits every candidate turn', async () => {
        installSummaryContext();
        const chat = makeSizedChat(2, { userLength: 500, assistantLength: 2000 });
        const settings = makeSummarySettings({
            verbatimTokenBudget: 4000,
            minSummaryBudget: 6000,
            maxL0SourceTokens: 24000,
            minSummaryTurns: 2,
            maxSummaryTurns: 5,
        });

        const plan = await buildForceSummaryRoutePlan(chat, makeSummaryStore(), settings);

        expect(plan.route).toBe(SUMMARY_ROUTES.FORCE);
        expect(plan.reason).toBe('force');
        expect(plan.ready).toBe(true);
        expect(plan.commitMode).toBe(SUMMARY_COMMIT_MODES.TURNS);
        expect(plan.totalBatches).toBe(1);
        expect(plan.batchTurns.map((turn) => turn.index)).toEqual([1]);
    });

    it('stays idle on an empty chat', async () => {
        installSummaryContext();

        const plan = await buildForceSummaryRoutePlan(
            [],
            makeSummaryStore(),
            makeSummarySettings(),
        );

        expect(plan.reason).toBe('none');
        expect(plan.ready).toBe(false);
        expect(plan.totalBatches).toBe(0);
    });
});
