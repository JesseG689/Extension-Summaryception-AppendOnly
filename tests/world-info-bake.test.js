import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureWorldInfoBake, injectPendingWorldInfoBake } from '../src/core/world-info-bake.js';
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
});
