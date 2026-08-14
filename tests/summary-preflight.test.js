import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareSummaryCycle } from '../src/core/summary-preflight.js';
import { installSummaryContext, makeMessage, makeSummaryStore } from './test-helpers.js';

describe('summary preflight', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps user and assistant replies and removes other system records', async () => {
        vi.spyOn(globalThis.crypto, 'randomUUID')
            .mockReturnValueOnce('user-id')
            .mockReturnValueOnce('wi-id')
            .mockReturnValueOnce('assistant-id');
        const chat = [
            makeMessage({ isUser: true, scId: undefined }),
            { ...makeMessage({ name: 'SC-WI', scId: undefined }), extra: {} },
            { ...makeMessage({ isSystem: true, scId: 'tool-id' }), extra: { type: 'tool' } },
            {
                ...makeMessage({ isSystem: true, name: 'Seraphina', scId: 'character-id' }),
                swipes: ['character reply'],
            },
            makeMessage({ scId: undefined }),
        ];
        const saveMetadata = vi.fn(async () => {});
        const saveChat = vi.fn(async () => {});
        const reloadCurrentChat = vi.fn(async () => {});
        const deleteMessage = vi.fn();
        const context = installSummaryContext({
            chat,
            metadata: { summaryception: makeSummaryStore() },
            saveMetadata,
            saveChat,
            reloadCurrentChat,
            deleteMessage,
        });

        const prepared = await prepareSummaryCycle();

        expect(deleteMessage).not.toHaveBeenCalled();
        expect(reloadCurrentChat).toHaveBeenCalledOnce();
        expect(prepared.chat).toBe(context.chat);
        expect(prepared.chat.map((message) => message.sc_id)).toEqual([
            'user-id',
            'character-id',
            'assistant-id',
        ]);
        expect(saveMetadata).toHaveBeenCalledTimes(1);
        expect(saveChat).toHaveBeenCalledTimes(2);
    });

    it('does not persist when IDs and chat content are unchanged', async () => {
        const saveMetadata = vi.fn(async () => {});
        const saveChat = vi.fn(async () => {});
        installSummaryContext({
            chat: [makeMessage({ scId: 'stable-id' })],
            saveMetadata,
            saveChat,
        });

        await prepareSummaryCycle();

        expect(saveMetadata).not.toHaveBeenCalled();
        expect(saveChat).not.toHaveBeenCalled();
    });
});
