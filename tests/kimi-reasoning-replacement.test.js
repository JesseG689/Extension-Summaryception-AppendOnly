import { describe, expect, it } from 'vitest';
import { MEMORY_MODES } from '../src/foundation/constants.js';
import { replaceKimiReasoningInRequest } from '../src/core/kimi-reasoning-replacement.js';

const settings = {
    enabled: true,
    memoryMode: MEMORY_MODES.APPEND_ONLY,
    replaceKimiReasoning: true,
    kimiReasoningReplacement: 'I should continue the story.',
};

function payload(overrides = {}) {
    return {
        chat_completion_source: 'custom',
        model: 'kimi-k3',
        messages: [
            { role: 'assistant', content: 'old', reasoning: 'bad prior thought' },
            { role: 'system', content: 'lore' },
            { role: 'assistant', content: 'mid' },
            { role: 'user', content: 'go on' },
        ],
        ...overrides,
    };
}

describe('replaceKimiReasoningInRequest', () => {
    it('seeds every assistant history message, with or without saved reasoning', () => {
        const request = payload();

        expect(replaceKimiReasoningInRequest(request, settings)).toBe(2);
        expect(request.messages).toEqual([
            {
                role: 'assistant',
                content: 'old',
                reasoning_content: 'I should continue the story.',
            },
            { role: 'system', content: 'lore' },
            {
                role: 'assistant',
                content: 'mid',
                reasoning_content: 'I should continue the story.',
            },
            { role: 'user', content: 'go on' },
        ]);
    });

    it('leaves a trailing assistant prefill message untouched', () => {
        const request = payload({
            messages: [
                { role: 'assistant', content: 'old', reasoning: 'bad prior thought' },
                { role: 'user', content: 'go on' },
                { role: 'assistant', content: 'partial prefill' },
            ],
        });

        expect(replaceKimiReasoningInRequest(request, settings)).toBe(1);
        expect(request.messages[0].reasoning_content).toBe('I should continue the story.');
        expect(request.messages[2]).toEqual({ role: 'assistant', content: 'partial prefill' });
    });

    it.each([
        ['disabled', { ...settings, replaceKimiReasoning: false }, {}],
        ['non-append mode', { ...settings, memoryMode: MEMORY_MODES.BALANCED }, {}],
        ['other model', { ...settings }, { model: 'gpt-4' }],
        ['other source', { ...settings }, { chat_completion_source: 'openai' }],
        ['structured output', { ...settings }, { json_schema: { type: 'object' } }],
        ['tools', { ...settings }, { tools: [{ type: 'function' }] }],
    ])('does not modify requests for %s', (_name, featureSettings, overrides) => {
        const request = payload(overrides);
        const before = structuredClone(request);

        expect(replaceKimiReasoningInRequest(request, featureSettings)).toBe(0);
        expect(request).toEqual(before);
    });

    it('does not send an empty replacement', () => {
        const request = payload();

        expect(
            replaceKimiReasoningInRequest(request, {
                ...settings,
                kimiReasoningReplacement: '   ',
            }),
        ).toBe(0);
        expect(request.messages[0].reasoning).toBe('bad prior thought');
        expect(request.messages[2].reasoning_content).toBeUndefined();
    });
});
