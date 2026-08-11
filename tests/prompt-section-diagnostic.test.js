import { beforeEach, describe, expect, it } from 'vitest';

import { onChatCompletionPromptReady } from '../src/entry/events.js';

const { logger } = globalThis.summaryceptionFoundationMocks;

describe('onChatCompletionPromptReady', () => {
    beforeEach(() => {
        logger.debug.mockClear();
    });

    it('reports one prefix summary per real prompt', () => {
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

        expect(logger.debug).toHaveBeenCalledTimes(1);
        expect(logger.debug.mock.calls[0][0]).toContain(
            'Prompt prefix BROKEN at block 1: previous 2, current 3',
        );
    });

    it('ignores dry-run prompt events in either event signature', () => {
        logger.debug.mockClear();
        onChatCompletionPromptReady({ chat: [{ role: 'system', content: 'dry' }] }, true);
        onChatCompletionPromptReady({ chat: [{ role: 'system', content: 'dry' }], dryRun: true });
        expect(logger.debug).not.toHaveBeenCalled();
    });
});
