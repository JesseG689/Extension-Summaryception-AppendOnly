import { describe, expect, it } from 'vitest';

import { MASK_USER_ROLE_MODES, UI_MODES } from '../src/foundation/constants.js';
import {
    bumpSummaryStoreMutationEpoch,
    getChatStore,
    getCurrentSummarizedBoundary,
    getEffectiveSettings,
    getPlayerName,
    getSettings,
    getSummaryStoreMutationEpoch,
} from '../src/foundation/state.js';
import {
    installSummaryContext,
    installSillyTavernStub,
    makeMessages,
    makeSummaryStore,
} from './test-helpers.js';

describe('getSettings', () => {
    it('returns a settings object and reuses the same reference on subsequent calls', () => {
        installSummaryContext();
        const first = getSettings();
        expect(typeof first).toBe('object');
        // The module stores rather than re-clones an existing settings object.
        expect(getSettings()).toBe(first);
        // A handful of known default keys are present.
        for (const key of ['enabled', 'minSummaryTurns', 'memoryTokenBudget']) {
            expect(Object.hasOwn(first, key)).toBe(true);
        }
    });

    it('backfills missing keys in place onto a raw partial settings object', () => {
        const ctx = installSillyTavernStub({ settings: { enabled: true } });
        const settings = getSettings();
        // The stored reference is the returned reference.
        expect(ctx.extensionSettings.summaryception).toBe(settings);
        // It gained default keys it did not have before…
        expect(Object.hasOwn(settings, 'memoryTokenBudget')).toBe(true);
        // …while the originally-provided key survived unchanged.
        expect(settings.enabled).toBe(true);
    });
    it('migrates persisted cache modes to balanced', () => {
        installSummaryContext({
            settings: { memoryMode: 'cache', easyMemoryMode: 'cache' },
        });

        const settings = getSettings();

        expect(settings.memoryMode).toBe('balanced');
        expect(settings.easyMemoryMode).toBe('balanced');
    });

    it.each([MASK_USER_ROLE_MODES.MARKER_LAST, MASK_USER_ROLE_MODES.KEEP_LAST_USER])(
        'repairs prefix-breaking mask mode %s when Append Only is selected',
        (maskUserRoleMode) => {
            installSummaryContext({
                settings: { memoryMode: 'append_only', maskUserRoleMode },
            });

            expect(getSettings().maskUserRoleMode).toBe(MASK_USER_ROLE_MODES.MARKER_FIRST);
        },
    );

    it('keeps Rewrite All with Append Only because its prefix remains stable', () => {
        installSummaryContext({
            settings: {
                memoryMode: 'append_only',
                maskUserRoleMode: MASK_USER_ROLE_MODES.REWRITE_ALL,
            },
        });

        expect(getSettings().maskUserRoleMode).toBe(MASK_USER_ROLE_MODES.REWRITE_ALL);
    });

    it('repairs an Advanced setting after switching from a forbidden mask mode to Append Only', () => {
        installSummaryContext({
            settings: {
                uiMode: UI_MODES.ADVANCED,
                memoryMode: 'balanced',
                maskUserRoleMode: MASK_USER_ROLE_MODES.MARKER_LAST,
            },
        });
        const settings = getSettings();
        settings.memoryMode = 'append_only';

        expect(getSettings().maskUserRoleMode).toBe(MASK_USER_ROLE_MODES.MARKER_FIRST);
    });

    it('repairs an Easy setting after switching from a forbidden mask mode to Append Only', () => {
        installSummaryContext({
            settings: {
                uiMode: UI_MODES.EASY,
                easyMemoryMode: 'balanced',
                maskUserRoleMode: MASK_USER_ROLE_MODES.KEEP_LAST_USER,
            },
        });
        const settings = getSettings();
        settings.easyMemoryMode = 'append_only';

        expect(getSettings().maskUserRoleMode).toBe(MASK_USER_ROLE_MODES.MARKER_FIRST);
    });
});

describe('getEffectiveSettings', () => {
    it('forces enabled:false in OFF mode (the OFF branch disables the effective settings)', () => {
        // The settings normalizer enforces the invariant enabled === (uiMode !== 'off'),
        // so OFF deterministically yields disabled effective settings. We assert
        // the OFF-branch output directly: the plan's "raw stays enabled:true" half
        // is not reflectable through getSettings() because normalizeModeSettings
        // overwrites enabled to match the mode — drift noted, contract class
        // (branching) preserved.
        installSummaryContext({ settings: { uiMode: UI_MODES.OFF, enabled: true } });
        const effective = getEffectiveSettings();
        expect(effective.enabled).toBe(false);
        // Calling again stays OFF deterministically.
        expect(getEffectiveSettings().enabled).toBe(false);
    });

    it('returns the same settings reference in ADVANCED mode', () => {
        installSummaryContext({ settings: { uiMode: UI_MODES.ADVANCED } });
        expect(getEffectiveSettings()).toBe(getSettings());
    });

    it('returns an enabled object with the derived Easy-mode values', () => {
        // installSummaryContext defaults uiMode to 'easy' (the makeSummarySettings
        // default), so an explicit Easy override exercises the same path.
        installSummaryContext({ settings: { uiMode: UI_MODES.EASY } });
        const effective = getEffectiveSettings();
        expect(typeof effective).toBe('object');
        expect(effective.enabled).toBe(true);
    });

    it('projects the selected Easy memory mode into runtime settings', () => {
        installSummaryContext({
            settings: { uiMode: UI_MODES.EASY, easyMemoryMode: 'append_only' },
        });

        expect(getEffectiveSettings().memoryMode).toBe('append_only');
    });

    it('preserves Append Only bake limits in Easy runtime settings', () => {
        installSummaryContext({
            settings: {
                uiMode: UI_MODES.EASY,
                easyMemoryMode: 'append_only',
                maxBakedWorldInfoEntries: 7,
                bakedWorldInfoTokenBudget: 7000,
            },
        });

        expect(getEffectiveSettings()).toMatchObject({
            maxBakedWorldInfoEntries: 7,
            bakedWorldInfoTokenBudget: 7000,
        });
    });
});

describe('getChatStore', () => {
    it('creates a normalized default store on a fresh context', () => {
        installSummaryContext();
        const store = getChatStore();
        expect(store).toMatchObject({ layers: [], ghostedMessageIds: [], mutationEpoch: 0 });
    });

    it('normalizes UUID arrays and rejects source-less snippets', () => {
        installSummaryContext({
            metadata: {
                summaryception: {
                    layers: [
                        [
                            { text: 'valid', sourceMessageIds: ['a', '', 'a', 'b'] },
                            { text: 'source-less' },
                        ],
                    ],
                    ghostedMessageIds: ['b', '', 'b', 'a'],
                    mutationEpoch: NaN,
                },
            },
        });

        const store = getChatStore();
        expect(store.layers).toEqual([[{ text: 'valid', sourceMessageIds: ['a', 'b'] }]]);
        expect(store.ghostedMessageIds).toEqual(['b', 'a']);
        expect(store.mutationEpoch).toBe(0);
    });
});

describe('summary store mutation epoch', () => {
    it('counts up from a normalized baseline on each bump', () => {
        installSummaryContext();
        const store = getChatStore();
        expect(bumpSummaryStoreMutationEpoch(store)).toBe(1);
        expect(store.mutationEpoch).toBe(1);
        expect(bumpSummaryStoreMutationEpoch(store)).toBe(2);
    });

    it('normalizes a bad epoch value to 0 without throwing', () => {
        expect(getSummaryStoreMutationEpoch({ mutationEpoch: 'bad' })).toBe(0);
        expect(getSummaryStoreMutationEpoch(undefined)).toBe(0);
    });
});

describe('getCurrentSummarizedBoundary', () => {
    it('returns -1 when no Layer 0 source ID resolves', () => {
        expect(getCurrentSummarizedBoundary(makeMessages(2), makeSummaryStore())).toBe(-1);
    });

    it('tracks surviving source IDs after a live message deletion shifts indices', () => {
        const chat = makeMessages(5);
        const store = makeSummaryStore({
            layers: [[{ text: 'summary', sourceMessageIds: ['message-1', 'message-4'] }]],
        });

        expect(getCurrentSummarizedBoundary(chat, store)).toBe(4);
        chat.splice(2, 1);
        expect(getCurrentSummarizedBoundary(chat, store)).toBe(3);
    });
});

describe('getPlayerName', () => {
    it('returns name1 from the installed context', () => {
        installSummaryContext();
        expect(getPlayerName()).toBe('Player1');
    });

    it('falls back to "User" when name1 is absent', () => {
        const ctx = installSummaryContext();
        delete ctx.name1;
        expect(getPlayerName()).toBe('User');
    });
});
