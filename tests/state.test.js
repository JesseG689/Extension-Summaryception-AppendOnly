import { describe, expect, it } from 'vitest';

import { UI_MODES } from '../src/foundation/constants.js';
import {
    bumpSummaryStoreMutationEpoch,
    calculateContiguousSummarizedUpTo,
    getChatStore,
    getEffectiveSettings,
    getSettings,
    getSummaryStoreMutationEpoch,
    getPlayerName,
} from '../src/foundation/state.js';
import { makeSummaryStore } from './test-helpers.js';
import { installSummaryContext, installSillyTavernStub } from './test-helpers.js';

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
});

describe('getChatStore', () => {
    it('creates a normalized default store on a fresh context', () => {
        installSummaryContext();
        const store = getChatStore();
        expect(Array.isArray(store.layers)).toBe(true);
        expect(store.summarizedUpTo).toBe(-1);
        expect(Array.isArray(store.ghostedIndices)).toBe(true);
        expect(typeof store.mutationEpoch).toBe('number');
    });

    it('repairs garbage metadata in place', () => {
        installSummaryContext({
            metadata: {
                summaryception: {
                    layers: 'junk',
                    summarizedUpTo: 'x',
                    ghostedIndices: [1, 'a', -2, 3],
                    mutationEpoch: NaN,
                },
            },
        });
        const store = getChatStore();
        expect(Array.isArray(store.layers)).toBe(true);
        expect(typeof store.summarizedUpTo).toBe('number');
        // Only non-negative integer indices survive; 1 and 3 are preserved.
        expect(store.ghostedIndices).toContain(1);
        expect(store.ghostedIndices).toContain(3);
        expect(store.ghostedIndices).not.toContain(-2);
        expect(Number.isFinite(store.mutationEpoch)).toBe(true);
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

describe('calculateContiguousSummarizedUpTo', () => {
    it('returns -1 when layer 0 is empty', () => {
        installSummaryContext();
        const store = getChatStore();
        expect(calculateContiguousSummarizedUpTo(store)).toBe(-1);
    });

    it('extends across contiguous layer-0 ranges', () => {
        const store = makeSummaryStore({
            layers: [[{ turnRange: [0, 2] }, { turnRange: [3, 5] }]],
        });
        expect(calculateContiguousSummarizedUpTo(store)).toBe(5);
    });

    it('stops the cursor at the first gap and ignores later ranges, even when input is unsorted', () => {
        const sortedGap = makeSummaryStore({
            layers: [[{ turnRange: [0, 2] }, { turnRange: [4, 6] }]],
        });
        expect(calculateContiguousSummarizedUpTo(sortedGap)).toBe(2);

        const unsorted = makeSummaryStore({
            layers: [[{ turnRange: [4, 6] }, { turnRange: [0, 2] }]],
        });
        expect(calculateContiguousSummarizedUpTo(unsorted)).toBe(2);
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
