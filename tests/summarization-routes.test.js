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
    makeSizedChat,
    makeSummarySettings,
    makeSummaryStore,
} from './test-helpers.js';

const readySettings = (memoryMode) =>
    makeSummarySettings({
        memoryMode,
        verbatimTokenBudget: 100,
        queuedTokenBudget: 500,
        minSummaryBudget: 3000,
        maxL0SourceTokens: 4000,
        minSummaryTurns: 1,
    });

describe('buildAutoSummaryRoutePlan', () => {
    it.each([
        [MEMORY_MODES.BALANCED, SUMMARY_ROUTES.STANDARD_AUTO, SUMMARY_COMMIT_MODES.TURNS],
        [
            MEMORY_MODES.PREFIX_CACHE,
            SUMMARY_ROUTES.CACHE_AUTO,
            SUMMARY_COMMIT_MODES.ATOMIC_PARTITIONS,
        ],
        [
            MEMORY_MODES.APPEND_ONLY,
            SUMMARY_ROUTES.CACHE_AUTO,
            SUMMARY_COMMIT_MODES.ATOMIC_PARTITIONS,
        ],
    ])('uses one recent/queued readiness result for %s', async (mode, route, commitMode) => {
        installSummaryContext();
        const chat = makeSizedChat(8, { userLength: 400, assistantLength: 400 });
        const plan = await buildAutoSummaryRoutePlan(chat, makeSummaryStore(), readySettings(mode));
        expect(plan.route).toBe(route);
        expect(plan.commitMode).toBe(commitMode);
        expect(plan.reason).toBe('ready');
        expect(plan.ready).toBe(true);
    });

    it('Balanced routes only the first partition', async () => {
        installSummaryContext();
        const chat = makeSizedChat(8, { userLength: 400, assistantLength: 400 });
        const plan = await buildAutoSummaryRoutePlan(
            chat,
            makeSummaryStore(),
            readySettings(MEMORY_MODES.BALANCED),
        );
        expect(plan.partitions).toHaveLength(2);
        expect(plan.batchTurns).toBe(plan.partitions[0].turns);
        expect(plan.batchTurns.length).toBeLessThan(plan.overflowCount);
        expect(plan.totalBatches).toBe(1);
    });

    it.each([MEMORY_MODES.PREFIX_CACHE, MEMORY_MODES.APPEND_ONLY])(
        '%s routes every B partition atomically',
        async (mode) => {
            installSummaryContext();
            const chat = makeSizedChat(8, { userLength: 400, assistantLength: 400 });
            const plan = await buildAutoSummaryRoutePlan(
                chat,
                makeSummaryStore(),
                readySettings(mode),
            );
            expect(plan.partitions).toHaveLength(2);
            expect(plan.totalBatches).toBe(plan.partitions.length);
            expect(plan.partitions.flatMap((part) => part.turns)).toHaveLength(plan.overflowCount);
        },
    );

    it('stays idle below Recent + Queued despite max turns', async () => {
        installSummaryContext();
        const chat = makeSizedChat(8, { userLength: 20, assistantLength: 60 });
        const plan = await buildAutoSummaryRoutePlan(
            chat,
            makeSummaryStore(),
            makeSummarySettings({
                memoryMode: MEMORY_MODES.BALANCED,
                verbatimTokenBudget: 10000,
                queuedTokenBudget: 10000,
                maxSummaryTurns: 2,
            }),
        );
        expect(plan.reason).toBe('none');
        expect(plan.ready).toBe(false);
    });
});

describe('buildForceSummaryRoutePlan', () => {
    it('ignores Recent + Queued and partitions every eligible assistant turn', async () => {
        installSummaryContext();
        const chat = makeSizedChat(2, { userLength: 20, assistantLength: 60 });
        const plan = await buildForceSummaryRoutePlan(
            chat,
            makeSummaryStore(),
            makeSummarySettings({
                verbatimTokenBudget: 10000,
                queuedTokenBudget: 10000,
                minSummaryBudget: 100,
                maxL0SourceTokens: 200,
            }),
        );
        expect(plan.reason).toBe('force');
        expect(plan.ready).toBe(true);
        expect(plan.batchTurns.map((turn) => turn.index)).toEqual([1, 3]);
    });

    it('stays idle on empty chat', async () => {
        installSummaryContext();
        const plan = await buildForceSummaryRoutePlan(
            [],
            makeSummaryStore(),
            makeSummarySettings(),
        );
        expect(plan.reason).toBe('none');
        expect(plan.ready).toBe(false);
    });
});
