import { afterEach, describe, expect, it, vi } from 'vitest';

const callSummarizer = vi.hoisted(() => vi.fn());
vi.mock('../src/core/summarizer-request.js', () => ({ callSummarizer }));

import { summarizeBatchFromTurns } from '../src/core/summarizer-batch.js';
import {
    installBrowserRuntimeStub,
    installSummaryContext,
    makeMessage,
    makeSummaryStore,
} from './test-helpers.js';

describe('Layer 0 deferred cleanup commit', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        callSummarizer.mockReset();
    });

    function buildChat() {
        return [
            makeMessage({ isUser: true, scId: 'user-id', mes: 'User scene.' }),
            { ...makeMessage({ scId: 'lore-id', mes: 'Baked lore.' }), name: 'SC-WI' },
            makeMessage({ scId: 'assistant-id', mes: 'Assistant scene.' }),
        ];
    }

    it('shows one start toast and a completion toast after commit', async () => {
        const { toastr } = installBrowserRuntimeStub();
        const chat = buildChat();
        installSummaryContext({ chat, metadata: { summaryception: makeSummaryStore() } });
        callSummarizer.mockResolvedValue(
            `[NARRATIVE]\nA concise summary.\n[STATE]\nlocation: room`,
        );

        await expect(summarizeBatchFromTurns([{ index: 2 }], { showToasts: true })).resolves.toBe(
            true,
        );

        expect(toastr.info).toHaveBeenCalledOnce();
        expect(toastr.info).toHaveBeenCalledWith(
            'Updating conversation memory…',
            'Summaryception',
            {
                timeOut: 0,
                extendedTimeOut: 0,
                tapToDismiss: false,
                progressBar: true,
            },
        );
        expect(toastr.clear).toHaveBeenCalledOnce();
        expect(toastr.success).toHaveBeenCalledWith(
            'Conversation memory updated.',
            'Summaryception',
            { timeOut: 3000 },
        );
    });
    it('assigns missing IDs on the live chat before capturing the source snapshot', async () => {
        vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('assistant-id');
        const chat = buildChat();
        delete chat[2].sc_id;
        const metadata = { summaryception: makeSummaryStore() };
        installSummaryContext({ chat, metadata });
        callSummarizer.mockResolvedValue(
            `[NARRATIVE]\nA concise summary.\n[STATE]\nlocation: room`,
        );

        await expect(summarizeBatchFromTurns([{ index: 2 }])).resolves.toBe(true);

        expect(metadata.summaryception.layers[0][0].sourceMessageIds).toEqual([
            'user-id',
            'lore-id',
            'assistant-id',
        ]);
    });

    it('keeps non-conversation records until the summarizer resolves and commits', async () => {
        const chat = buildChat();
        const metadata = { summaryception: makeSummaryStore() };
        const saveMetadata = vi.fn(async () => {});
        const saveChat = vi.fn(async () => {});
        const reloadCurrentChat = vi.fn(async () => {});
        let resolveSummary;
        callSummarizer.mockImplementation(
            () =>
                new Promise((resolve) => {
                    resolveSummary = resolve;
                }),
        );
        installSummaryContext({
            chat,
            metadata,
            saveMetadata,
            saveChat,
            reloadCurrentChat,
        });

        const resultPromise = summarizeBatchFromTurns([{ index: 2 }]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(chat.map((message) => message.sc_id)).toEqual([
            'user-id',
            'lore-id',
            'assistant-id',
        ]);
        expect(saveChat).not.toHaveBeenCalled();
        resolveSummary(`[NARRATIVE]\nA concise summary.\n[STATE]\nlocation: room`);
        await expect(resultPromise).resolves.toBe(true);

        expect(chat.map((message) => message.sc_id)).toEqual(['user-id', 'assistant-id']);
        expect(metadata.summaryception.layers[0]).toHaveLength(1);
        expect(saveChat).toHaveBeenCalledOnce();
        expect(reloadCurrentChat).toHaveBeenCalledOnce();
        expect(saveMetadata).toHaveBeenCalled();
    });

    it('ghosts stable source ids before scoped cleanup shifts live indices', async () => {
        const chat = [
            makeMessage({ isUser: true, scId: 'user-id', mes: 'User scene.' }),
            { ...makeMessage({ scId: 'lore-id', mes: 'Old baked roll.' }), name: 'SC-WI' },
            makeMessage({ scId: 'assistant-id', mes: 'Assistant scene.' }),
            {
                ...makeMessage({ scId: 'current-roll-id', mes: 'Current user roll.' }),
                name: 'SC-WI',
            },
            makeMessage({ isUser: true, scId: 'live-user-id', mes: 'Current user.' }),
            makeMessage({ scId: 'live-assistant-id', mes: 'Current assistant response.' }),
        ];
        const calls = [];
        const reloadedChatIds = [];
        installSummaryContext({
            chat,
            metadata: { summaryception: makeSummaryStore() },
            executeSlashCommandsWithOptions: async (command) => calls.push(String(command)),
            reloadCurrentChat: async () => {
                calls.push('reload');
                reloadedChatIds.push(chat.map((message) => message.sc_id));
            },
        });
        callSummarizer.mockResolvedValue(
            `[NARRATIVE]\nA concise summary.\n[STATE]\nlocation: room`,
        );

        await expect(summarizeBatchFromTurns([{ index: 2 }])).resolves.toBe(true);

        expect(calls).toEqual(['/hide 0', '/hide 2', 'reload']);
        expect(chat.map((message) => message.sc_id)).toEqual([
            'user-id',
            'assistant-id',
            'current-roll-id',
            'live-user-id',
            'live-assistant-id',
        ]);
        expect(reloadedChatIds).toEqual([
            ['user-id', 'assistant-id', 'current-roll-id', 'live-user-id', 'live-assistant-id'],
        ]);
    });

    it('does not flush or reload when the committed source contains no temporary records', async () => {
        const chat = [
            makeMessage({ isUser: true, scId: 'user-id', mes: 'User scene.' }),
            makeMessage({ scId: 'assistant-id', mes: 'Assistant scene.' }),
        ];
        const saveChat = vi.fn(async () => {});
        const reloadCurrentChat = vi.fn(async () => {});
        installSummaryContext({
            chat,
            metadata: { summaryception: makeSummaryStore() },
            saveChat,
            reloadCurrentChat,
        });
        callSummarizer.mockResolvedValue(
            `[NARRATIVE]\nA concise summary.\n[STATE]\nlocation: room`,
        );

        await expect(summarizeBatchFromTurns([{ index: 1 }])).resolves.toBe(true);

        expect(saveChat).not.toHaveBeenCalled();
        expect(reloadCurrentChat).not.toHaveBeenCalled();
    });

    it('restores chat and Layer 0 when post-mutation persistence fails', async () => {
        const chat = buildChat();
        const originalChat = [...chat];
        const metadata = { summaryception: makeSummaryStore() };
        let metadataSaves = 0;
        const saveMetadata = vi.fn(async () => {
            metadataSaves++;
            if (metadataSaves === 2) {
                throw new Error('metadata write failed');
            }
        });
        installSummaryContext({ chat, metadata, saveMetadata });
        callSummarizer.mockResolvedValue(
            `[NARRATIVE]\nA concise summary.\n[STATE]\nlocation: room`,
        );
        await expect(summarizeBatchFromTurns([{ index: 2 }])).rejects.toThrow(
            'metadata write failed',
        );

        expect(chat).toEqual(originalChat);
        expect(metadata.summaryception.layers[0]).toEqual([]);
        expect(metadata.summaryception.mutationEpoch).toBe(0);
    });
});
