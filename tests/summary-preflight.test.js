import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupSummaryCycle, prepareSummaryCycle } from '../src/core/summary-preflight.js';
import { runElasticAutoCycle } from '../src/core/summarizer-engine.js';
import { installSummaryContext, makeMessage, makeSummaryStore } from './test-helpers.js';

const { context } = globalThis.summaryceptionFoundationMocks;

describe('summary preflight', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps baked and host system records during ordinary cycle preparation', async () => {
        vi.spyOn(globalThis.crypto, 'randomUUID')
            .mockReturnValueOnce('user-id')
            .mockReturnValueOnce('wi-id')
            .mockReturnValueOnce('assistant-id');
        const chat = [
            makeMessage({ isUser: true, scId: undefined }),
            { ...makeMessage({ name: 'SC-WI', scId: undefined }), extra: {} },
            { ...makeMessage({ isSystem: true, scId: 'tool-id' }), extra: { type: 'tool' } },
            makeMessage({ scId: undefined }),
        ];
        const saveMetadata = vi.fn(async () => {});
        const saveChat = vi.fn(async () => {});
        const reloadCurrentChat = vi.fn(async () => {});
        const context = installSummaryContext({
            chat,
            metadata: { summaryception: makeSummaryStore() },
            saveMetadata,
            saveChat,
            reloadCurrentChat,
        });

        const prepared = await prepareSummaryCycle();

        expect(reloadCurrentChat).not.toHaveBeenCalled();
        expect(prepared.chat).toBe(context.chat);
        expect(prepared.chat.map((message) => message.sc_id)).toEqual([
            'user-id',
            'wi-id',
            'tool-id',
            'assistant-id',
        ]);
        expect(saveMetadata).toHaveBeenCalledOnce();
        expect(saveChat).toHaveBeenCalledOnce();
    });

    it('removes non-conversation records only at the explicit summary boundary', async () => {
        const chat = [
            makeMessage({ isUser: true, scId: 'user-id' }),
            { ...makeMessage({ name: 'SC-WI', scId: 'wi-id' }), extra: {} },
            { ...makeMessage({ isSystem: true, scId: 'tool-id' }), extra: { type: 'tool' } },
            makeMessage({ scId: 'assistant-id' }),
        ];
        const saveMetadata = vi.fn(async () => {});
        const saveChat = vi.fn(async () => {});
        const reloadCurrentChat = vi.fn(async () => {});
        installSummaryContext({
            chat,
            metadata: { summaryception: makeSummaryStore() },
            saveMetadata,
            saveChat,
            reloadCurrentChat,
        });

        await expect(cleanupSummaryCycle()).resolves.toBe(2);

        expect(chat.map((message) => message.sc_id)).toEqual(['user-id', 'assistant-id']);
        expect(context.synchronizeRemovedChatMessages).toHaveBeenCalledWith([1, 2]);
        expect(reloadCurrentChat).not.toHaveBeenCalled();
        expect(saveMetadata).toHaveBeenCalledOnce();
        expect(saveChat).toHaveBeenCalledTimes(2);
    });

    it('does not clear system records when the post-generation automatic cycle is idle', async () => {
        const chat = [
            makeMessage({ isUser: true, scId: 'user-id' }),
            { ...makeMessage({ name: 'SC-WI', scId: 'wi-id' }), extra: { sc_wi: { version: 3 } } },
            makeMessage({ scId: 'assistant-id' }),
        ];
        const saveChat = vi.fn(async () => {});
        const reloadCurrentChat = vi.fn(async () => {});
        installSummaryContext({ chat, saveChat, reloadCurrentChat });
        const queue = { setPhase: vi.fn() };

        await expect(runElasticAutoCycle(queue)).resolves.toBe('idle');

        expect(chat.map((message) => message.sc_id)).toEqual(['user-id', 'wi-id', 'assistant-id']);
        expect(saveChat).not.toHaveBeenCalled();
        expect(reloadCurrentChat).not.toHaveBeenCalled();
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
