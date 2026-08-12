import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    captureWorldInfoBake,
    injectPendingWorldInfoBake,
    migrateWorldInfoToBakeOutlet,
    unbakeWorldInfo,
} from '../src/core/world-info-bake.js';
import { installSummaryContext, makeMessage } from './test-helpers.js';

const { context } = globalThis.summaryceptionFoundationMocks;

function installBakeContext({ chat, outlet = 'formatted lore', budget = 10000 } = {}) {
    const runtime = installSummaryContext({
        chat: chat || [
            makeMessage({ isUser: true, mes: 'old user' }),
            makeMessage({ mes: 'assistant reply' }),
            makeMessage({ isUser: true, mes: 'latest user' }),
        ],
        settings: {
            memoryMode: 'append_only',
            memoryTokenBudget: budget,
        },
        extensionPrompts: {
            customWIOutlet_sc_bake: { value: outlet },
        },
        getTokenCountAsync: vi.fn(async (text) => text.length),
    });
    context.getChat.mockImplementation(() => runtime.chat);
    context.getContext.mockImplementation(() => runtime);
    context.getPromptTokenCapacity.mockReturnValue(null);
    context.countPromptPayloadTokens.mockResolvedValue(null);
    return runtime;
}

function activateBakeEntries() {
    captureWorldInfoBake([
        { uid: 2, order: 10, outletName: 'other' },
        { uid: 3, order: 20, outletName: 'sc_bake' },
        { uid: 1, order: 30, outletName: 'sc_bake' },
    ]);
}

describe('world info bake', () => {
    beforeEach(() => {
        captureWorldInfoBake([]);
    });

    it('splices equivalent system content before the latest user in payload and storage', async () => {
        const runtime = installBakeContext();
        const prompt = [
            { role: 'system', content: 'fixed' },
            { role: 'user', content: 'old user' },
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries();

        await expect(injectPendingWorldInfoBake({ chat: prompt })).resolves.toBe(true);

        expect(prompt.slice(-3)).toEqual([
            { role: 'assistant', content: 'assistant reply' },
            { role: 'system', content: 'formatted lore' },
            { role: 'user', content: 'latest user' },
        ]);
        expect(runtime.chat.slice(-3).map((message) => message.mes)).toEqual([
            'assistant reply',
            'formatted lore',
            'latest user',
        ]);
        expect(runtime.chat.at(-2)).toMatchObject({
            name: 'SC-WI',
            is_user: false,
            is_system: false,
            force_avatar: 'img/five.png',
            extra: {
                type: 'narrator',
                isSmallSys: true,
                api: 'summaryception',
                model: 'sc_wi_bake',
                sc_wi: { uids: [1, 3], version: 1 },
            },
        });
        expect(context.renderInsertedChatMessage).toHaveBeenCalledWith(
            runtime.chat.at(-2),
            runtime.chat.length - 2,
        );
    });

    it('preserves the prior payload as the next turn prefix', async () => {
        const runtime = installBakeContext({ outlet: 'turn one lore' });
        const firstPrompt = [
            { role: 'user', content: 'old user' },
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries();
        await injectPendingWorldInfoBake({ chat: firstPrompt });

        runtime.chat.push(makeMessage({ mes: 'new assistant' }));
        runtime.chat.push(makeMessage({ isUser: true, mes: 'next user' }));
        runtime.extensionPrompts.customWIOutlet_sc_bake.value = 'turn two lore';
        const secondPrompt = [
            ...firstPrompt,
            { role: 'assistant', content: 'new assistant' },
            { role: 'user', content: 'next user' },
        ];
        activateBakeEntries();
        await injectPendingWorldInfoBake({ chat: secondPrompt });

        expect(secondPrompt.slice(0, firstPrompt.length)).toEqual(firstPrompt);
        expect(secondPrompt.slice(-3)).toEqual([
            { role: 'assistant', content: 'new assistant' },
            { role: 'system', content: 'turn two lore' },
            { role: 'user', content: 'next user' },
        ]);
    });

    it('caps oversized outlet text and skips repeated prompt-ready events', async () => {
        const runtime = installBakeContext({ outlet: 'x'.repeat(5000), budget: 4000 });
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries();

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(prompt.at(-2)).toEqual({ role: 'system', content: 'x'.repeat(4000) });
        expect(runtime.chat.at(-2).mes).toBe('x'.repeat(4000));

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(false);
        expect(prompt.filter((message) => message.role === 'system')).toHaveLength(1);
    });

    it('caps the post-splice bake to remaining provider prompt capacity', async () => {
        const runtime = installBakeContext({ outlet: 'x'.repeat(100), budget: 4000 });
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        context.getPromptTokenCapacity.mockReturnValue(1000);
        context.countPromptPayloadTokens.mockImplementation(async (messages) => {
            const bake = messages.find((message) => message.role === 'system');
            return 970 + (bake?.content.length || 0);
        });
        activateBakeEntries();

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(prompt.at(-2)?.content).toBe('x'.repeat(30));
        expect(runtime.chat.at(-2)?.mes).toBe('x'.repeat(30));
    });

    it('skips retry, continue, and rapid-user tails that lack one assistant/user fork', async () => {
        const tails = [
            [
                makeMessage({ mes: 'assistant reply' }),
                { ...makeMessage({ mes: 'old bake' }), extra: { sc_wi: { version: 1 } } },
                makeMessage({ isUser: true, mes: 'latest user' }),
            ],
            [makeMessage({ isUser: true, mes: 'latest user' }), makeMessage({ mes: 'continue' })],
            [
                makeMessage({ mes: 'assistant reply' }),
                makeMessage({ isUser: true, mes: 'first quick reply' }),
                makeMessage({ isUser: true, mes: 'second quick reply' }),
            ],
        ];

        for (const chat of tails) {
            const runtime = installBakeContext({ chat });
            activateBakeEntries();
            expect(
                await injectPendingWorldInfoBake({
                    chat: [{ role: 'user', content: chat.at(-1)?.mes }],
                }),
            ).toBe(false);
            expect(runtime.chat).toHaveLength(chat.length);
        }
    });

    it('uses the full-width narrator style when compact bakes are disabled', async () => {
        const runtime = installBakeContext();
        runtime.extensionSettings.summaryception.compactBakes = false;
        activateBakeEntries();

        await injectPendingWorldInfoBake({ chat: [{ role: 'user', content: 'latest user' }] });

        expect(runtime.chat.at(-2)?.extra?.isSmallSys).toBe(false);
    });

    it('skips dry runs and tails that do not satisfy the assistant fork rule', async () => {
        const dryRuntime = installBakeContext();
        const dryPrompt = [{ role: 'user', content: 'latest user' }];
        activateBakeEntries();
        expect(await injectPendingWorldInfoBake({ chat: dryPrompt, dryRun: true })).toBe(false);
        expect(dryRuntime.chat).toHaveLength(3);

        const firstTurn = installBakeContext({
            chat: [makeMessage({ isUser: true, mes: 'first user' })],
        });
        activateBakeEntries();
        expect(
            await injectPendingWorldInfoBake({ chat: [{ role: 'user', content: 'first user' }] }),
        ).toBe(false);
        expect(firstTurn.chat).toHaveLength(1);
    });

    it('accepts normal SillyTavern assistant messages that omit is_system', async () => {
        const runtime = installBakeContext();
        delete runtime.chat.at(-2).is_system;
        activateBakeEntries();

        expect(
            await injectPendingWorldInfoBake({
                chat: [
                    { role: 'assistant', content: 'assistant reply' },
                    { role: 'user', content: 'latest user' },
                ],
            }),
        ).toBe(true);
        expect(runtime.chat.at(-2)?.extra?.sc_wi).toEqual({ uids: [1, 3], version: 1 });
    });
});

describe('world info migration', () => {
    it('moves dynamic entries and restores their exact positions during unbake', async () => {
        const chat = [
            makeMessage({ mes: 'assistant reply' }),
            { ...makeMessage({ mes: 'baked lore' }), extra: { sc_wi: { version: 1 } } },
            makeMessage({ isUser: true, mes: 'latest user' }),
        ];
        installBakeContext({ chat });
        const book = {
            entries: {
                1: { uid: 1, constant: false, position: 0 },
                2: { uid: 2, constant: false, position: 4, outletName: 'other' },
                3: { uid: 3, constant: true, position: 0 },
                4: { uid: 4, constant: false, position: 7, outletName: 'existing' },
            },
        };
        context.getWorldInfoNames.mockReturnValue(['book', 'missing']);
        context.loadWorldInfo.mockImplementation(async (name) => (name === 'book' ? book : null));
        context.saveWorldInfo.mockResolvedValue(true);
        context.deleteChatMessage.mockImplementation(async (index) => {
            chat.splice(index, 1);
            return true;
        });

        await expect(migrateWorldInfoToBakeOutlet()).resolves.toEqual({ books: 1, entries: 2 });
        expect(book.entries[1]).toMatchObject({
            position: 7,
            outletName: 'sc_bake',
            extensions: { summaryceptionBake: { position: 0 } },
        });
        expect(book.entries[2].extensions.summaryceptionBake).toEqual({
            position: 4,
            outletName: 'other',
        });
        expect(book.entries[3].position).toBe(0);
        expect(book.entries[4].outletName).toBe('existing');

        await expect(unbakeWorldInfo()).resolves.toEqual({ books: 1, entries: 2, messages: 1 });
        expect(book.entries[1].position).toBe(0);
        expect(book.entries[1]).not.toHaveProperty('outletName');
        expect(book.entries[2]).toMatchObject({ position: 4, outletName: 'other' });
        expect(book.entries[1].extensions).not.toHaveProperty('summaryceptionBake');
        expect(chat.map((message) => message.mes)).toEqual(['assistant reply', 'latest user']);
    });
});
