import { describe, expect, it } from 'vitest';

import { buildEffectiveMemoryText } from '../src/core/memory-budget.js';

describe('buildEffectiveMemoryText', () => {
    it('replaces every {{summary}} occurrence in the injection template', () => {
        const layers = [[{ text: 'some memory' }]];
        const result = buildEffectiveMemoryText(layers, {
            injectionTemplate: 'A {{summary}} B {{summary}} C',
        });

        expect(result).not.toContain('{{summary}}');
        expect(result).toContain('A ');
        expect(result).toContain(' B ');
        expect(result).toContain(' C');
        const memoryText = '[CHRONOLOGY]\nsome memory';
        const occurrences = result.split(memoryText).length - 1;
        expect(occurrences).toBe(2);
    });

    it('inserts memory text containing $-sequences literally', () => {
        const layers = [[{ text: 'price is $& and $1 special' }]];
        const result = buildEffectiveMemoryText(layers, {
            injectionTemplate: 'A {{summary}} B {{summary}} C',
        });

        expect(result).not.toContain('{{summary}}');
        expect(result).toContain('price is $& and $1 special');
        const occurrences = result.split('price is $& and $1 special').length - 1;
        expect(occurrences).toBe(2);
    });
});
