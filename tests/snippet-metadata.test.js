import { describe, expect, it } from 'vitest';

import {
    buildPromotedSnippetMetadata,
    extractSnippetMetadata,
    formatAnchoredSnippetNarrative,
    formatCompactSnippetAnchor,
    formatSnippetAnchor,
    stripLeadingSnippetAnchor,
} from '../src/core/snippet-metadata.js';

describe('extractSnippetMetadata', () => {
    it('normalizes a valid source range and known datetime', () => {
        expect(
            extractSnippetMetadata({ sourceRange: [2, 5], currentDateTime: '2024-01-02 14' }),
        ).toEqual({ sourceRange: [2, 5], currentDateTime: '2024-01-02 14' });
    });

    it.each([
        ['reversed range', [5, 2]],
        ['negative start', [-1, 3]],
        ['non-integer bound', [1.5, 3]],
        ['too short', [3]],
        ['non-array', 'nope'],
    ])('drops an invalid range (%s)', (_label, sourceRange) => {
        expect(extractSnippetMetadata({ sourceRange })).not.toHaveProperty('sourceRange');
    });

    it.each(['unknown', 'UNKNOWN', ''])('drops placeholder datetime (%s)', (currentDateTime) => {
        expect(extractSnippetMetadata({ currentDateTime })).not.toHaveProperty('currentDateTime');
    });

    it('returns an empty object for empty input', () => {
        expect(extractSnippetMetadata()).toEqual({});
    });
});

describe('buildPromotedSnippetMetadata', () => {
    it('unions the source range across children', () => {
        const result = buildPromotedSnippetMetadata([
            { sourceRange: [3, 5] },
            { sourceRange: [0, 2] },
            { sourceRange: [6, 9] },
        ]);
        expect(result.sourceRange).toEqual([0, 9]);
    });

    it('ignores children without a range', () => {
        const result = buildPromotedSnippetMetadata([
            { currentDateTime: 'unknown' },
            { sourceRange: [1, 4] },
        ]);
        expect(result.sourceRange).toEqual([1, 4]);
    });

    it('takes the last known datetime', () => {
        expect(
            buildPromotedSnippetMetadata([
                { currentDateTime: '2024-01-01 09' },
                { currentDateTime: 'unknown' },
                { currentDateTime: '2024-01-03 20' },
            ]).currentDateTime,
        ).toBe('2024-01-03 20');
    });

    it('takes the rightmost known datetime when later children are unknown', () => {
        expect(
            buildPromotedSnippetMetadata([{ currentDateTime: '2024-01-05 08' }, {}])
                .currentDateTime,
        ).toBe('2024-01-05 08');
    });

    it('returns an empty object for empty input', () => {
        expect(buildPromotedSnippetMetadata([])).toEqual({});
    });
});

describe('formatSnippetAnchor', () => {
    it('formats range and datetime', () => {
        expect(formatSnippetAnchor({ sourceRange: [2, 7], currentDateTime: '2024-01-02 14' })).toBe(
            '[msgs 2-7; current 2024-01-02 14]',
        );
    });

    it('falls back to unknown datetime', () => {
        const result = formatSnippetAnchor({ sourceRange: [2, 7] });
        expect(result).toContain('msgs 2-7');
        expect(result.endsWith('current unknown]')).toBe(true);
    });

    it('returns an empty string without a range', () => {
        expect(formatSnippetAnchor({ currentDateTime: '2024-01-02 14' })).toBe('');
    });
});

describe('formatCompactSnippetAnchor', () => {
    it('compacts a date-hour datetime', () => {
        expect(
            formatCompactSnippetAnchor({ sourceRange: [2, 7], currentDateTime: '2024-01-02 14' }),
        ).toBe('[2-7@2024-01-02T14]');
    });

    it('falls back to the raw value for a non-compactible datetime', () => {
        expect(
            formatCompactSnippetAnchor({ sourceRange: [2, 7], currentDateTime: 'sometime later' }),
        ).toBe('[2-7@sometime later]');
    });

    it('omits the datetime segment when absent', () => {
        expect(formatCompactSnippetAnchor({ sourceRange: [2, 7] })).toBe('[2-7]');
    });

    it('returns an empty string without a range', () => {
        expect(formatCompactSnippetAnchor({})).toBe('');
    });
});

describe('stripLeadingSnippetAnchor', () => {
    it('strips a leading NARRATIVE header', () => {
        expect(stripLeadingSnippetAnchor('[NARRATIVE] The scene opens.')).toBe('The scene opens.');
    });

    it('strips one or more leading anchor blocks', () => {
        expect(stripLeadingSnippetAnchor('[msgs 2-7] [msgs 8-9] Real prose here.')).toBe(
            'Real prose here.',
        );
    });

    it('strips a bulleted anchor with extra metadata', () => {
        expect(stripLeadingSnippetAnchor('- [msgs 2-7; current 2024-01-02 14] Prose.')).toBe(
            'Prose.',
        );
    });

    it('preserves text with no leading anchor', () => {
        expect(stripLeadingSnippetAnchor('Just prose.')).toBe('Just prose.');
    });

    it.each([null, ''])('returns an empty string for empty input (%s)', (input) => {
        expect(stripLeadingSnippetAnchor(input)).toBe('');
    });
});

describe('formatAnchoredSnippetNarrative', () => {
    it('joins the anchor and narrative', () => {
        const result = formatAnchoredSnippetNarrative({
            sourceRange: [2, 7],
            currentDateTime: '2024-01-02 14',
            text: '[NARRATIVE] Something happened.',
        });
        expect(result.startsWith('[msgs 2-7; current 2024-01-02 14]')).toBe(true);
        expect(result).toContain('Something happened.');
    });

    it('omits the anchor when there is no range', () => {
        expect(formatAnchoredSnippetNarrative({ text: '[NARRATIVE] Something happened.' })).toBe(
            'Something happened.',
        );
    });
});
