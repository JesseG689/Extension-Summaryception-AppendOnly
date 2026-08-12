import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    captureWorldInfoBake,
    injectPendingWorldInfoBake,
    migrateWorldInfoToBakeOutlet,
    unbakeWorldInfo,
} from '../src/core/world-info-bake.js';
import { installSummaryContext, makeMessage } from './test-helpers.js';

const { context } = globalThis.summaryceptionFoundationMocks;

function installBakeContext({
    chat,
    outlet = 'formatted lore',
    budget = 5000,
    maxEntries = 10,
} = {}) {
    const runtime = installSummaryContext({
        chat: chat || [
            makeMessage({ isUser: true, mes: 'old user' }),
            makeMessage({ mes: 'assistant reply' }),
            makeMessage({ isUser: true, mes: 'latest user' }),
        ],
        settings: {
            memoryMode: 'append_only',
            bakedWorldInfoTokenBudget: budget,
            maxBakedWorldInfoEntries: maxEntries,
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

function activateBakeEntries(entries) {
    captureWorldInfoBake(
        entries || [
            { uid: 2, world: 'book', order: 10, outletName: 'other', content: 'ignored' },
            { uid: 3, world: 'book', order: 20, outletName: 'sc_bake', content: 'lore three' },
            { uid: 1, world: 'book', order: 30, outletName: 'sc_bake', content: 'lore one' },
        ],
    );
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

        const content = prompt.at(-2)?.content;
        expect(prompt.slice(-3)).toEqual([
            { role: 'assistant', content: 'assistant reply' },
            { role: 'system', content },
            { role: 'user', content: 'latest user' },
        ]);
        expect(content).toMatch(/^<world_info>\n[\s\S]*<wi>\n[\s\S]*<\/wi>[\s\S]*<\/world_info>$/);
        expect(content.match(/<wi>/g)).toHaveLength(2);
        expect(content.match(/<\/wi>/g)).toHaveLength(2);
        expect(runtime.chat.slice(-3).map((message) => message.mes)).toEqual([
            'assistant reply',
            content,
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
                sc_wi: {
                    entries: [
                        { world: 'book', uid: 1 },
                        { world: 'book', uid: 3 },
                    ],
                    version: 2,
                },
            },
        });
        expect(context.renderInsertedChatMessage).toHaveBeenCalledWith(
            runtime.chat.at(-2),
            runtime.chat.length - 2,
        );
    });

    it('does not rebake entries already present in visible chat history', async () => {
        const runtime = installBakeContext();
        const firstPrompt = [
            { role: 'user', content: 'old user' },
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries();
        await injectPendingWorldInfoBake({ chat: firstPrompt });

        runtime.chat.push(makeMessage({ mes: 'new assistant' }));
        runtime.chat.push(makeMessage({ isUser: true, mes: 'next user' }));
        const secondPrompt = [
            ...firstPrompt,
            { role: 'assistant', content: 'new assistant' },
            { role: 'user', content: 'next user' },
        ];
        activateBakeEntries();

        expect(await injectPendingWorldInfoBake({ chat: secondPrompt })).toBe(false);
        expect(secondPrompt).toEqual([
            ...firstPrompt,
            { role: 'assistant', content: 'new assistant' },
            { role: 'user', content: 'next user' },
        ]);
    });

    it('scopes duplicate identities by lorebook and reads legacy UID markers', async () => {
        const runtime = installBakeContext();
        runtime.chat.unshift(
            {
                ...makeMessage({ mes: 'existing composite bake' }),
                extra: { sc_wi: { entries: [{ world: 'other-book', uid: 1 }], version: 2 } },
            },
            {
                ...makeMessage({ mes: 'existing legacy bake' }),
                extra: { sc_wi: { uids: [2], version: 1 } },
            },
        );
        activateBakeEntries([
            { uid: 1, world: 'book', order: 30, outletName: 'sc_bake', content: 'new book lore' },
            {
                uid: 2,
                world: 'book',
                order: 20,
                outletName: 'sc_bake',
                content: 'legacy duplicate',
            },
        ]);
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(prompt.at(-2)?.content).toMatch(
            /^<world_info>\n[\s\S]*<wi>\nnew book lore\n<\/wi>[\s\S]*<\/world_info>$/,
        );
        expect(runtime.chat.at(-2)?.extra?.sc_wi.entries).toEqual([{ world: 'book', uid: 1 }]);
    });

    it('applies World Info regex processing to each entry before wrapping', async () => {
        installBakeContext();
        context.processWorldInfoText.mockImplementation(async (text, depth) => `${text}:${depth}`);
        activateBakeEntries([
            { uid: 1, world: 'book', depth: 4, outletName: 'sc_bake', content: 'raw lore' },
        ]);
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(context.processWorldInfoText).toHaveBeenCalledWith('raw lore', 4);
        expect(prompt.at(-2)?.content).toMatch(
            /^<world_info>\n[\s\S]*<wi>\nraw lore:4\n<\/wi>[\s\S]*<\/world_info>$/,
        );
    });

    it('limits each turn to the configured number of highest-order entries', async () => {
        const runtime = installBakeContext({ maxEntries: 5 });
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries(
            Array.from({ length: 6 }, (_, index) => ({
                uid: index + 1,
                world: 'book',
                order: 60 - index,
                outletName: 'sc_bake',
                content: `lore ${index + 1}`,
            })),
        );

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(runtime.chat.at(-2)?.extra?.sc_wi.entries).toHaveLength(5);
        expect(prompt.at(-2)?.content).toContain('lore 5');
        expect(prompt.at(-2)?.content).not.toContain('lore 6');
    });

    it('selects complete entry blocks under the text budget', async () => {
        const runtime = installBakeContext({ budget: 4000 });
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries([
            { uid: 1, world: 'book', order: 30, outletName: 'sc_bake', content: 'x'.repeat(100) },
            { uid: 2, world: 'book', order: 20, outletName: 'sc_bake', content: 'y'.repeat(4000) },
        ]);

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(prompt.at(-2)?.content).toContain(`<wi>\n${'x'.repeat(100)}\n</wi>`);
        expect(runtime.chat.at(-2)?.extra?.sc_wi.entries).toEqual([{ world: 'book', uid: 1 }]);
    });

    it('selects complete entry blocks under remaining provider capacity', async () => {
        installBakeContext({ budget: 4000 });
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        context.getPromptTokenCapacity.mockReturnValue(1000);
        context.countPromptPayloadTokens.mockImplementation(async (messages) => {
            const bake = messages.find((message) => message.role === 'system');
            return 900 + (bake?.content.includes('y'.repeat(10)) ? 200 : 0);
        });
        activateBakeEntries([
            { uid: 1, world: 'book', order: 30, outletName: 'sc_bake', content: 'x'.repeat(10) },
            { uid: 2, world: 'book', order: 20, outletName: 'sc_bake', content: 'y'.repeat(10) },
        ]);

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(prompt.at(-2)?.content).toContain(`<wi>\n${'x'.repeat(10)}\n</wi>`);
        expect(prompt.at(-2)?.content).not.toMatch(/<wi>[\s\S]*y{10}[\s\S]*<\/wi>/);
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
        expect(runtime.chat.at(-2)?.extra?.sc_wi).toEqual({
            entries: [
                { world: 'book', uid: 1 },
                { world: 'book', uid: 3 },
            ],
            version: 2,
        });
    });

    it('allows an entry to bake again after its prior marker is hidden', async () => {
        const runtime = installBakeContext();
        runtime.chat.unshift({
            ...makeMessage({ mes: '<wi>\nlore one\n</wi>' }),
            is_hidden: true,
            extra: { sc_wi: { entries: [{ world: 'book', uid: 1 }], version: 2 } },
        });
        activateBakeEntries([
            { uid: 1, world: 'book', order: 30, outletName: 'sc_bake', content: 'lore one' },
        ]);

        expect(
            await injectPendingWorldInfoBake({
                chat: [
                    { role: 'assistant', content: 'assistant reply' },
                    { role: 'user', content: 'latest user' },
                ],
            }),
        ).toBe(true);
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
