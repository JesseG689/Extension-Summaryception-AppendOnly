import { afterEach, describe, expect, it, vi } from 'vitest';

import { prepareSummaryCycle } from '../src/core/summary-preflight.js';
import { installSummaryContext, makeMessage, makeSummaryStore } from './test-helpers.js';

describe('summary preflight', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('assigns IDs, deletes stale World Info, re-reads chat, and persists once', async () => {
        vi.spyOn(globalThis.crypto, 'randomUUID')
            .mockReturnValueOnce('user-id')
            .mockReturnValueOnce('wi-id')
            .mockReturnValueOnce('assistant-id');
        const chat = [
            makeMessage({ isUser: true, scId: undefined }),
            { ...makeMessage({ name: 'SC-WI', scId: undefined }), extra: {} },
            makeMessage({ scId: undefined }),
        ];
        const saveMetadata = vi.fn(async () => {});
        const saveChat = vi.fn(async () => {});
        const deleteMessage = vi.fn(async (index) => {
            chat.splice(index, 1);
            return true;
        });
        const context = installSummaryContext({
            chat,
            metadata: { summaryception: makeSummaryStore() },
            saveMetadata,
            saveChat,
            deleteMessage,
        });

        const prepared = await prepareSummaryCycle();

        expect(deleteMessage).toHaveBeenCalledWith(1, undefined, false);
        expect(prepared.chat).toBe(context.chat);
        expect(prepared.chat.map((message) => message.sc_id)).toEqual(['user-id', 'assistant-id']);
        expect(prepared.chat.some((message) => message.name === 'SC-WI')).toBe(false);
        expect(saveMetadata).toHaveBeenCalledTimes(1);
        expect(saveChat).toHaveBeenCalledTimes(1);
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
