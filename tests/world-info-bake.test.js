import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    captureWorldInfoBake,
    deleteNonConversationMessages,
    injectPendingWorldInfoBake,
    prepareWorldInfoEntriesForAppendOnly,
    setWorldInfoBakeGenerationType,
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
    appendOnlySystemBlockTemplate,
    appendOnlyEmptySystemBlockTemplate,
    appendOnlyInjectEmptySystemBlock = false,
    appendOnlyUserRollMode = 'standard',
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
            ...(appendOnlySystemBlockTemplate === undefined
                ? {}
                : { appendOnlySystemBlockTemplate }),
            ...(appendOnlyEmptySystemBlockTemplate === undefined
                ? {}
                : { appendOnlyEmptySystemBlockTemplate }),
            appendOnlyInjectEmptySystemBlock,
            appendOnlyUserRollMode,
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
        setWorldInfoBakeGenerationType('normal');
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
        expect(content).toMatch(
            /^Rolls - User:[\s\S]*\n<details>\n<summary>Injected 2 memories<\/summary>[\s\S]*<wi>[\s\S]*<\/wi>[\s\S]*<\/details>$/,
        );
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
                        { world: 'book', uid: 1, revision: expect.stringMatching(/^r1-/) },
                        { world: 'book', uid: 3, revision: expect.stringMatching(/^r1-/) },
                    ],
                    version: 4,
                },
            },
        });
        expect(context.renderInsertedChatMessage).toHaveBeenCalledWith(
            runtime.chat.at(-2),
            runtime.chat.length - 2,
        );
    });

    it('expands seven rolls once and persists the exact resolved block', async () => {
        context.expandSillyTavernMacros.mockClear();
        const runtime = installBakeContext();
        context.expandSillyTavernMacros.mockImplementation(async (template) =>
            template.replaceAll('{{roll::1d20}}', (_macro, offset) => String((offset % 20) + 1)),
        );
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries();
        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(context.expandSillyTavernMacros).toHaveBeenCalledTimes(1);
        expect(
            context.expandSillyTavernMacros.mock.calls[0][0].match(/{{roll::1d20}}/g),
        ).toHaveLength(7);
        expect(prompt.at(-2).content).toBe(runtime.chat.at(-2).mes);
        expect(prompt.at(-2).content).not.toContain('{{roll::1d20}}');
    });

    it.each([
        ['standard', '{{roll::1d20}}', 1, 7],
        ['heroic', '{{roll::1d13+7}}', 8, 6],
        ['superhero', '{{roll::1d11+9}}', 10, 6],
    ])(
        'uses the %s User range without changing Assistant or Chekhov dice',
        async (mode, userMacro, expectedUser, standardMacroCount) => {
            context.expandSillyTavernMacros.mockClear();
            const runtime = installBakeContext({ appendOnlyUserRollMode: mode });
            context.expandSillyTavernMacros.mockImplementation(async (template) =>
                template
                    .replaceAll('{{roll::1d13+7}}', '8')
                    .replaceAll('{{roll::1d11+9}}', '10')
                    .replaceAll('{{roll::1d20}}', '1'),
            );
            const prompt = [
                { role: 'assistant', content: 'assistant reply' },
                { role: 'user', content: 'latest user' },
            ];
            activateBakeEntries();

            expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);

            const expandedInput = context.expandSillyTavernMacros.mock.calls[0][0];
            expect(expandedInput).toContain(`User: ${userMacro}`);
            expect(expandedInput.match(/{{roll::1d20}}/g)).toHaveLength(standardMacroCount);
            expect(expandedInput).toContain('Assistant: {{roll::1d20}}');
            expect(prompt.at(-2)?.content).toContain(
                `Rolls - User: ${expectedUser} | Assistant: 1 | Chekhov: 1, 1, 1, 1, 1`,
            );
            expect(prompt.at(-2)?.content).toBe(runtime.chat.at(-2)?.mes);
        },
    );

    it('applies Superhero mode to the standard empty dice block', async () => {
        installBakeContext({
            appendOnlyInjectEmptySystemBlock: true,
            appendOnlyUserRollMode: 'superhero',
        });
        context.expandSillyTavernMacros.mockImplementation(async (template) =>
            template.replaceAll('{{roll::1d11+9}}', '10').replaceAll('{{roll::1d20}}', '1'),
        );
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(prompt.at(-2)?.content).toBe(
            'Rolls - User: 10 | Assistant: 1 | Chekhov: 1, 1, 1, 1, 1',
        );
    });

    it('leaves a custom User dice formula under template control', async () => {
        context.expandSillyTavernMacros.mockClear();
        installBakeContext({
            appendOnlySystemBlockTemplate:
                'Rolls - User: {{roll::2d10}} | Assistant: {{roll::1d20}}\n{{entries}}',
            appendOnlyUserRollMode: 'superhero',
        });
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries();

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        const expandedInput = context.expandSillyTavernMacros.mock.calls[0][0];
        expect(expandedInput).toContain('User: {{roll::2d10}}');
        expect(expandedInput).not.toContain('{{roll::1d11+9}}');
    });

    it('uses escaped entry comments and numbered title fallbacks', async () => {
        installBakeContext();
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries([
            {
                uid: 1,
                world: 'book',
                order: 30,
                outletName: 'sc_bake',
                comment: 'Known <truth>',
                content: 'one',
            },
            { uid: 2, world: 'book', order: 20, outletName: 'sc_bake', content: 'two' },
        ]);
        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(prompt.at(-2).content).toContain('<summary>Known &lt;truth&gt;</summary>');
        expect(prompt.at(-2).content).toContain('<summary>Memory 2</summary>');
    });

    it.each(['regenerate', 'swipe', 'continue'])(
        'does not inject during %s generation',
        async (generationType) => {
            const runtime = installBakeContext();
            const prompt = [
                { role: 'assistant', content: 'assistant reply' },
                { role: 'user', content: 'latest user' },
            ];
            setWorldInfoBakeGenerationType(generationType);
            activateBakeEntries();
            expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(false);
            expect(prompt).toHaveLength(2);
            expect(runtime.chat).toHaveLength(3);
        },
    );

    it('does not inject pre-routed lore when Summaryception is turned off', async () => {
        const runtime = installBakeContext();
        runtime.extensionSettings.summaryception.uiMode = 'off';
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries([
            {
                uid: 1,
                world: 'SC - legacy book',
                outletName: 'sc_bake',
                content: 'legacy pre-routed lore',
            },
        ]);

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(false);
        expect(prompt).toHaveLength(2);
        expect(runtime.chat).toHaveLength(3);
        expect(runtime.chat.some((message) => message.extra?.sc_wi)).toBe(false);
    });

    it('does not inject a system message when no memories are available by default', async () => {
        const runtime = installBakeContext();
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        context.expandSillyTavernMacros.mockClear();

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(false);
        expect(prompt).toHaveLength(2);
        expect(runtime.chat).toHaveLength(3);
        expect(context.expandSillyTavernMacros).not.toHaveBeenCalled();
    });

    it('uses the empty template when enabled and all lore is already baked', async () => {
        const runtime = installBakeContext({
            appendOnlyEmptySystemBlockTemplate: 'EMPTY {{roll::1d20}}',
            appendOnlyInjectEmptySystemBlock: true,
        });
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries();
        await injectPendingWorldInfoBake({ chat: prompt });
        runtime.chat.push(makeMessage({ mes: 'new assistant' }));
        runtime.chat.push(makeMessage({ isUser: true, mes: 'next user' }));
        const secondPrompt = [
            ...prompt,
            { role: 'assistant', content: 'new assistant' },
            { role: 'user', content: 'next user' },
        ];
        context.expandSillyTavernMacros.mockClear();
        context.expandSillyTavernMacros.mockImplementation(async (template) =>
            template.replaceAll('{{roll::1d20}}', '17'),
        );
        activateBakeEntries();

        expect(await injectPendingWorldInfoBake({ chat: secondPrompt })).toBe(true);
        expect(secondPrompt.at(-2)?.content).toBe('EMPTY 17');
        expect(runtime.chat.at(-2)?.mes).toBe('EMPTY 17');
        expect(secondPrompt.at(-2)?.content).not.toContain('Injected 0 memories');
        expect(secondPrompt.at(-2)?.content).not.toContain('<!--');
        expect(context.expandSillyTavernMacros).toHaveBeenCalledTimes(1);
    });

    it('does not reroll or duplicate the current user turn block', async () => {
        context.expandSillyTavernMacros.mockClear();
        context.expandSillyTavernMacros.mockImplementation(async (template) =>
            template.replaceAll('{{roll::1d11+9}}', '14').replaceAll('{{roll::1d20}}', '6'),
        );
        const runtime = installBakeContext({ appendOnlyUserRollMode: 'superhero' });
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries();
        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        const firstContent = prompt.at(-2).content;
        activateBakeEntries();
        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(false);
        expect(prompt.at(-2).content).toBe(firstContent);
        expect(firstContent).toContain('User: 14 | Assistant: 6');
        expect(context.expandSillyTavernMacros).toHaveBeenCalledTimes(1);
        expect(runtime.chat.filter((message) => message.extra?.sc_wi)).toHaveLength(1);
    });

    it('scopes duplicate identities by lorebook and ignores legacy UID markers', async () => {
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
                content: 'legacy marker ignored',
            },
        ]);
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(prompt.at(-2)?.content).toContain('new book lore');
        expect(prompt.at(-2)?.content).toContain('legacy marker ignored');
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
        expect(prompt.at(-2)?.content).toContain('<wi>\nraw lore:4\n</wi>');
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
        expect(runtime.chat.at(-2)?.extra?.sc_wi.entries).toEqual([
            { world: 'book', uid: 1, revision: expect.stringMatching(/^r1-/) },
        ]);
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
                { world: 'book', uid: 1, revision: expect.stringMatching(/^r1-/) },
                { world: 'book', uid: 3, revision: expect.stringMatching(/^r1-/) },
            ],
            version: 4,
        });
    });

    it('rebakes legacy revisionless markers once to establish a current baseline', async () => {
        const runtime = installBakeContext();
        runtime.chat.unshift({
            ...makeMessage({ mes: '<wi>\nlore one\n</wi>' }),
            is_hidden: true,
            extra: { sc_wi: { entries: [{ world: 'book', uid: 1 }], version: 3 } },
        });
        activateBakeEntries([
            { uid: 1, world: 'book', order: 30, outletName: 'sc_bake', content: 'lore one' },
        ]);
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];

        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        expect(prompt.at(-2)?.content).toContain('lore one');
        expect(runtime.chat.filter((message) => message.extra?.sc_wi)).toHaveLength(2);
    });

    it('rebakes each changed or reverted entry revision once on activation', async () => {
        const runtime = installBakeContext();
        const makePrompt = (assistant, user) => [
            { role: 'assistant', content: assistant },
            { role: 'user', content: user },
        ];

        activateBakeEntries([
            { uid: 1, world: 'book', outletName: 'sc_bake', content: 'revision A' },
        ]);
        expect(
            await injectPendingWorldInfoBake({
                chat: makePrompt('assistant reply', 'latest user'),
            }),
        ).toBe(true);
        const firstRevision = runtime.chat.at(-2)?.extra?.sc_wi.entries[0].revision;

        runtime.chat.push(makeMessage({ mes: 'next assistant' }));
        runtime.chat.push(makeMessage({ isUser: true, mes: 'next user' }));
        activateBakeEntries([
            { uid: 1, world: 'book', outletName: 'sc_bake', content: 'revision B' },
        ]);
        expect(
            await injectPendingWorldInfoBake({ chat: makePrompt('next assistant', 'next user') }),
        ).toBe(true);
        const secondRevision = runtime.chat.at(-2)?.extra?.sc_wi.entries[0].revision;
        expect(secondRevision).not.toBe(firstRevision);

        runtime.chat.push(makeMessage({ mes: 'third assistant' }));
        runtime.chat.push(makeMessage({ isUser: true, mes: 'third user' }));
        activateBakeEntries([
            { uid: 1, world: 'book', outletName: 'sc_bake', content: 'revision A' },
        ]);
        expect(
            await injectPendingWorldInfoBake({ chat: makePrompt('third assistant', 'third user') }),
        ).toBe(true);
        expect(runtime.chat.at(-2)?.extra?.sc_wi.entries[0].revision).toBe(firstRevision);
    });

    it.each([
        ['title', { comment: 'Old title', depth: 2 }, { comment: 'New title', depth: 2 }],
        ['depth', { comment: 'Title', depth: 2 }, { comment: 'Title', depth: 4 }],
    ])('rebakes when the entry %s changes', async (_field, initial, updated) => {
        const runtime = installBakeContext();
        const prompt = [
            { role: 'assistant', content: 'assistant reply' },
            { role: 'user', content: 'latest user' },
        ];
        activateBakeEntries([
            { uid: 1, world: 'book', outletName: 'sc_bake', content: 'same lore', ...initial },
        ]);
        expect(await injectPendingWorldInfoBake({ chat: prompt })).toBe(true);
        const firstRevision = runtime.chat.at(-2)?.extra?.sc_wi.entries[0].revision;

        runtime.chat.push(makeMessage({ mes: 'next assistant' }));
        runtime.chat.push(makeMessage({ isUser: true, mes: 'next user' }));
        activateBakeEntries([
            { uid: 1, world: 'book', outletName: 'sc_bake', content: 'same lore', ...updated },
        ]);

        expect(
            await injectPendingWorldInfoBake({
                chat: [
                    { role: 'assistant', content: 'next assistant' },
                    { role: 'user', content: 'next user' },
                ],
            }),
        ).toBe(true);
        expect(runtime.chat.at(-2)?.extra?.sc_wi.entries[0].revision).not.toBe(firstRevision);
    });

    it('deletes marked and legacy SC-WI blocks from the full chat without DOM deletion', async () => {
        const chat = [
            makeMessage({ isUser: true, mes: 'old user', scId: 'user-old' }),
            { ...makeMessage({ mes: 'first bake', name: 'SC-WI', scId: 'wi-1' }), extra: {} },
            makeMessage({ isSystem: true, mes: 'host system message', scId: 'host-system' }),
            {
                ...makeMessage({ mes: 'second bake', name: 'SC-WI', scId: 'wi-2' }),
                extra: { sc_wi: { version: 2 } },
            },
            makeMessage({ isUser: true, mes: 'latest user', scId: 'user-latest' }),
        ];
        const saveChat = vi.fn();
        const reloadCurrentChat = vi.fn();
        const deleteMessage = vi.fn();
        const runtime = installBakeContext({ chat });
        Object.assign(runtime, { saveChat, reloadCurrentChat, deleteMessage });
        const store = {
            layers: [
                [
                    {
                        text: 'summary',
                        sourceMessageIds: ['user-old', 'wi-1', 'host-system'],
                    },
                ],
            ],
            ghostedMessageIds: ['user-old', 'wi-1'],
            mutationEpoch: 2,
        };

        await expect(deleteNonConversationMessages()).resolves.toBe(3);
        expect(deleteMessage).not.toHaveBeenCalled();
        expect(saveChat).toHaveBeenCalledOnce();
        expect(context.synchronizeRemovedChatMessages).toHaveBeenCalledWith([1, 2, 3]);
        expect(reloadCurrentChat).not.toHaveBeenCalled();
        expect(chat.map((message) => message.sc_id)).toEqual(['user-old', 'user-latest']);
        expect(store).toEqual({
            layers: [
                [
                    {
                        text: 'summary',
                        sourceMessageIds: ['user-old', 'wi-1', 'host-system'],
                    },
                ],
            ],
            ghostedMessageIds: ['user-old', 'wi-1'],
            mutationEpoch: 2,
        });
    });
});

describe('automatic Append Only lore routing', () => {
    beforeEach(() => {
        context.loadWorldInfo.mockClear();
        context.saveWorldInfo.mockClear();
    });

    it('routes active dynamic entries from every lore source without saving books', async () => {
        installBakeContext();
        const alreadyOutlet = {
            uid: 3,
            world: 'global',
            constant: false,
            position: 7,
            outletName: 'other',
        };
        const payload = {
            globalLore: [
                { uid: 1, world: 'global', constant: false, position: 0 },
                { uid: 2, world: 'global', constant: true, position: 0 },
                alreadyOutlet,
            ],
            characterLore: [{ uid: 1, world: 'character', position: 4 }],
            chatLore: [{ uid: 1, world: 'chat', position: 1 }],
            personaLore: [{ uid: 1, world: 'persona', position: 6 }],
        };

        await prepareWorldInfoEntriesForAppendOnly(payload);

        expect(payload.globalLore[0]).toMatchObject({ position: 7, outletName: 'sc_bake' });
        expect(payload.globalLore[1]).toMatchObject({ constant: true, position: 0 });
        expect(payload.globalLore[1]).not.toHaveProperty('outletName');
        expect(payload.globalLore[2]).toBe(alreadyOutlet);
        expect(payload.characterLore[0]).toMatchObject({ position: 7, outletName: 'sc_bake' });
        expect(payload.chatLore[0]).toMatchObject({ position: 7, outletName: 'sc_bake' });
        expect(payload.personaLore[0]).toMatchObject({ position: 7, outletName: 'sc_bake' });
        expect(context.saveWorldInfo).not.toHaveBeenCalled();
    });

    it('leaves loaded entries untouched outside supported Append Only chats', async () => {
        const cases = [
            { settings: { memoryMode: 'balanced' } },
            { settings: { memoryMode: 'prefix_cache' } },
            { settings: { uiMode: 'off', memoryMode: 'append_only' } },
            { settings: { memoryMode: 'append_only' }, groupId: 'group-1' },
        ];

        for (const testCase of cases) {
            const runtime = installSummaryContext({
                settings: testCase.settings,
                groupId: testCase.groupId,
            });
            context.getContext.mockImplementation(() => runtime);
            const entry = { uid: 1, world: 'book', position: 0 };

            await prepareWorldInfoEntriesForAppendOnly({
                globalLore: [entry],
                characterLore: [],
                chatLore: [],
                personaLore: [],
            });

            expect(entry).toEqual({ uid: 1, world: 'book', position: 0 });
        }
    });

    it('uses originals for selected legacy clones and falls back when no original exists', async () => {
        installBakeContext();
        context.getWorldInfoNames.mockReturnValue(['book', 'SC - book', 'SC - orphan']);
        context.loadWorldInfo.mockImplementation(async (name) =>
            name === 'book'
                ? {
                      entries: {
                          1: { uid: 1, constant: false, position: 0, content: 'current source' },
                          2: { uid: 2, constant: true, position: 1, content: 'constant source' },
                      },
                  }
                : null,
        );
        const payload = {
            globalLore: [
                { uid: 1, world: 'SC - book', position: 7, content: 'stale clone' },
                { uid: 1, world: 'SC - orphan', position: 7, content: 'orphan clone' },
            ],
            characterLore: [],
            chatLore: [],
            personaLore: [],
        };

        await prepareWorldInfoEntriesForAppendOnly(payload);

        expect(payload.globalLore).toEqual([
            {
                uid: 1,
                world: 'book',
                constant: false,
                position: 7,
                outletName: 'sc_bake',
                content: 'current source',
            },
            { uid: 2, world: 'book', constant: true, position: 1, content: 'constant source' },
            { uid: 1, world: 'SC - orphan', position: 7, content: 'orphan clone' },
        ]);
        expect(context.loadWorldInfo).toHaveBeenCalledOnce();
        expect(context.loadWorldInfo).toHaveBeenCalledWith('book');
    });

    it('drops a legacy clone when its original is already active', async () => {
        installBakeContext();
        context.getWorldInfoNames.mockReturnValue(['book', 'SC - book']);
        const payload = {
            globalLore: [{ uid: 1, world: 'SC - book', position: 7, content: 'clone' }],
            characterLore: [{ uid: 1, world: 'book', position: 0, content: 'source' }],
            chatLore: [],
            personaLore: [],
        };

        await prepareWorldInfoEntriesForAppendOnly(payload);

        expect(payload.globalLore).toEqual([]);
        expect(payload.characterLore).toEqual([
            { uid: 1, world: 'book', position: 7, outletName: 'sc_bake', content: 'source' },
        ]);
        expect(context.loadWorldInfo).not.toHaveBeenCalled();
    });
});

describe('world info migration', () => {
    it('clones books, preserves originals, and restores exact positions during unbake', async () => {
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
        const existingClone = {
            entries: {
                1: { uid: 1, constant: false, position: 7, outletName: 'sc_bake' },
            },
        };
        const bookFixture = structuredClone(book);
        const existingCloneFixture = structuredClone(existingClone);

        const books = {
            book,
            existing: { entries: { 1: { uid: 1, constant: false, position: 0 } } },
            'SC - existing': existingClone,
        };
        const names = ['book', 'existing', 'SC - existing', 'missing'];
        context.getWorldInfoNames.mockImplementation(() => [...names]);
        context.loadWorldInfo.mockImplementation(async (name) => {
            const source = books[name];
            return source ? structuredClone(source) : null;
        });
        context.saveWorldInfo.mockImplementation(async (name) => {
            if (!names.includes(name)) {
                names.push(name);
            }
            return true;
        });

        await expect(migrateWorldInfoToBakeOutlet()).resolves.toEqual({ books: 1, entries: 2 });

        // Source books are never mutated.
        expect(book).toEqual(bookFixture);
        expect(books.existing).toEqual({
            entries: { 1: { uid: 1, constant: false, position: 0 } },
        });
        expect(existingClone).toEqual(existingCloneFixture);

        // Only the newly derived clone is saved under the SC - <original> name.
        expect(context.saveWorldInfo).toHaveBeenCalledWith('SC - book', expect.any(Object));
        expect(context.saveWorldInfo).toHaveBeenCalledTimes(1);
        expect(context.saveWorldInfo).not.toHaveBeenCalledWith('SC - missing', expect.any(Object));
        // The source book is loaded to build the clone; the pre-existing clone is never loaded.
        expect(context.loadWorldInfo).toHaveBeenCalledWith('book');
        expect(context.loadWorldInfo).not.toHaveBeenCalledWith('SC - existing');
        // The existing source is skipped because its clone already exists, so it is never loaded.
        expect(context.loadWorldInfo).not.toHaveBeenCalledWith('existing');

        // Inspect the saved clone data for the source book.
        const savedBookCall = context.saveWorldInfo.mock.calls.find(
            (call) => call[0] === 'SC - book',
        );
        const savedBook = /** @type {{ entries: Record<string, object> }} */ (savedBookCall[1]);
        expect(savedBook.entries[1]).toMatchObject({
            position: 7,
            outletName: 'sc_bake',
            extensions: { summaryceptionBake: { position: 0 } },
        });
        expect(savedBook.entries[2].extensions.summaryceptionBake).toEqual({
            position: 4,
            outletName: 'other',
        });
        expect(savedBook.entries[3].position).toBe(0);
        expect(savedBook.entries[4].outletName).toBe('existing');

        // Rerunning the command performs no additional saves: every source now has a clone.
        context.saveWorldInfo.mockClear();
        await expect(migrateWorldInfoToBakeOutlet()).resolves.toEqual({ books: 0, entries: 0 });
        expect(context.saveWorldInfo).not.toHaveBeenCalled();

        // Restore the migrated clone entries and remove baked messages.
        context.loadWorldInfo.mockImplementation(async (name) => {
            if (name === 'SC - book') {
                return structuredClone(savedBook);
            }
            const source = books[name];
            return source ? structuredClone(source) : null;
        });
        await expect(unbakeWorldInfo()).resolves.toEqual({ books: 1, entries: 2, messages: 1 });

        const restoredCall = context.saveWorldInfo.mock.calls.find(
            (call) => call[0] === 'SC - book',
        );
        const restoredBook = /** @type {{ entries: Record<string, object> }} */ (restoredCall[1]);
        expect(restoredBook.entries[1].position).toBe(0);
        expect(restoredBook.entries[1]).not.toHaveProperty('outletName');
        expect(restoredBook.entries[2]).toMatchObject({ position: 4, outletName: 'other' });
        expect(restoredBook.entries[1].extensions).not.toHaveProperty('summaryceptionBake');
        expect(chat.map((message) => message.mes)).toEqual(['assistant reply', 'latest user']);

        // Originals remain pristine throughout unbake.
        expect(book).toEqual(bookFixture);
        expect(existingClone).toEqual(existingCloneFixture);
    });
});
