import { describe, expect, it } from 'vitest';

import { defaultSettings } from '../src/foundation/constants.js';

import {
    STATE_CATEGORIES,
    buildStateSchemaText,
    getActiveLineCap,
    getCategoryByKey,
    getEnabledCategories,
    getEnabledStateKeys,
    isCategoryEnabled,
} from '../src/foundation/state-categories.js';

const allEnabled = {
    stateCatDateTime: true,
    stateCatBonds: true,
    stateCatChekhov: true,
    stateCatGmNotes: true,
    stateCatInventory: true,
    stateCatLocation: true,
};

const dateTimeOnly = {
    stateCatDateTime: true,
    stateCatBonds: false,
    stateCatChekhov: false,
    stateCatGmNotes: false,
    stateCatInventory: false,
    stateCatLocation: false,
};

describe('state-categories catalog', () => {
    it('exposes a frozen six-entry catalog with the documented canonical keys', () => {
        expect(Object.isFrozen(STATE_CATEGORIES)).toBe(true);
        expect(STATE_CATEGORIES.map((c) => c.key)).toStrictEqual([
            'current_date_time',
            'bonds',
            'chekhov',
            'gm_notes',
            'inventory',
            'location',
        ]);
    });

    it('getCategoryByKey resolves known keys and returns undefined otherwise', () => {
        expect(getCategoryByKey('bonds')).toBe(STATE_CATEGORIES[1]);
        expect(getCategoryByKey('nope')).toBeUndefined();
    });

    it('default settings enable only current_date_time', () => {
        expect(getEnabledStateKeys(dateTimeOnly)).toStrictEqual(['current_date_time']);
        const text = buildStateSchemaText(dateTimeOnly);
        expect(text).toContain('current_date_time:');
        expect(text).not.toContain('bonds:');
    });

    it('all six enabled are returned in priority order (date-time first)', () => {
        expect(getEnabledStateKeys(allEnabled)).toStrictEqual([
            'current_date_time',
            'bonds',
            'chekhov',
            'gm_notes',
            'inventory',
            'location',
        ]);
        expect(getEnabledCategories(allEnabled)).toHaveLength(6);
    });

    it('getActiveLineCap sums enabled caps and clamps to the ceiling', () => {
        expect(getActiveLineCap(allEnabled)).toBe(36);
        expect(getActiveLineCap(allEnabled, 12)).toBe(12);
        expect(getActiveLineCap({})).toBe(2);
    });

    it('buildStateSchemaText fills {cap} and emits category-format tokens', () => {
        const text = buildStateSchemaText(allEnabled);
        expect(text).not.toContain('{cap}');
        expect(text).toContain('current_date_time:');
        expect(text).toContain('BOND:');
        expect(text).toContain('[BULLET:');
    });

    it('isCategoryEnabled handles unknown keys and always-on override of a falsey flag', () => {
        expect(isCategoryEnabled(allEnabled, 'definitely_not_a_key')).toBe(false);
        // alwaysOn wins even when the persisted flag is falsey / unset.
        expect(isCategoryEnabled({}, 'current_date_time')).toBe(true);
        expect(isCategoryEnabled({ stateCatDateTime: false }, 'current_date_time')).toBe(true);
    });

    it('an un-normalized settings object missing every stateCat* key reads as date-time-only', () => {
        // Raw objects bypass the getSettings() backfill, so only the alwaysOn
        // category survives. Normalized settings get the all-enabled defaults.
        const legacy = { someOtherSetting: true };
        expect(getEnabledStateKeys(legacy)).toStrictEqual(['current_date_time']);
        expect(getActiveLineCap(legacy)).toBe(2);
    });

    it('ships every category enabled by default except chekhov', () => {
        expect(getEnabledStateKeys(defaultSettings)).toStrictEqual(
            STATE_CATEGORIES.map((c) => c.key).filter((key) => key !== 'chekhov'),
        );
        expect(defaultSettings.stateCatChekhov).toBe(false);
    });

    it('ships with the [CURRENT STATE] injection off by default', () => {
        expect(defaultSettings.injectCurrentState).toBe(false);
    });
});
