import { beforeEach, describe, expect, it } from 'vitest';

import { onChatCompletionPromptReady } from '../src/entry/events.js';

const { logger } = globalThis.summaryceptionFoundationMocks;

describe('onChatCompletionPromptReady', () => {
    beforeEach(() => {
        logger.debug.mockClear();
    });

    it('reports stable and changed prompt sections against the previous turn', () => {
        onChatCompletionPromptReady({
            chat: [
                { role: 'system', content: 'fixed' },
                { role: 'user', content: 'first' },
            ],
        });
        logger.debug.mockClear();

        onChatCompletionPromptReady({
            chat: [
                { content: 'fixed', role: 'system' },
                { role: 'user', content: 'second' },
                { role: 'assistant', content: 'new' },
            ],
        });

        expect(logger.debug.mock.calls.map(([message]) => message)).toEqual([
            expect.stringContaining('(system):'),
            expect.stringContaining('(user):'),
            expect.stringContaining('(assistant):'),
        ]);
        expect(logger.debug.mock.calls[0][0]).toContain('[stable]');
        expect(logger.debug.mock.calls[1][0]).toContain('[changed]');
        expect(logger.debug.mock.calls[2][0]).toContain('[added]');
    });

    it('ignores dry-run prompt events', () => {
        onChatCompletionPromptReady({ chat: [{ role: 'system', content: 'dry' }] }, true);
        expect(logger.debug).not.toHaveBeenCalled();
    });
});
