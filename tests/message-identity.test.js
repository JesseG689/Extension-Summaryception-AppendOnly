import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    ensureChatScIds,
    ensureMessageScId,
    getMessageIndexByScId,
    rangesFromSortedIndices,
    resolveScIdsToIndices,
} from '../src/foundation/message-identity.js';
import { makeMessage } from './test-helpers.js';

describe('message identity', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('falls back to an RFC 4122 v4 UUID when randomUUID is unavailable', () => {
        const getRandomValues = vi.fn((bytes) => {
            bytes.set(Array.from({ length: 16 }, (_value, index) => index));
            return bytes;
        });
        vi.stubGlobal('crypto', { getRandomValues });

        const id = ensureMessageScId(makeMessage({ scId: undefined }));

        expect(id).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
        expect(getRandomValues).toHaveBeenCalledOnce();
    });

    it('uses a distinct non-crypto fallback when Web Crypto is unavailable', () => {
        vi.stubGlobal('crypto', {});
        vi.spyOn(Date, 'now').mockReturnValue(123456789);
        vi.spyOn(Math, 'random').mockReturnValueOnce(0.12345).mockReturnValueOnce(0.6789);

        const id = ensureMessageScId(makeMessage({ scId: undefined }));

        expect(id).toMatch(/^sc-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
    });

    it('assigns missing IDs and preserves top-level identity across extra replacement', () => {
        vi.spyOn(globalThis.crypto, 'randomUUID')
            .mockReturnValueOnce('message-1')
            .mockReturnValueOnce('message-2');
        const first = makeMessage({ scId: undefined });
        const second = makeMessage({ scId: '' });
        const chat = [first, second, null];

        expect(ensureChatScIds(chat)).toBe(true);
        expect(first.sc_id).toBe('message-1');
        expect(second.sc_id).toBe('message-2');

        first.extra = { replacedBySwipe: true };
        expect(ensureMessageScId(first)).toBe('message-1');
        expect(ensureChatScIds(chat)).toBe(false);
    });

    it('keeps the first duplicate ID and resolves unique current indices in order', () => {
        const chat = [
            makeMessage({ scId: 'duplicate' }),
            makeMessage({ scId: 'message-1' }),
            makeMessage({ scId: 'duplicate' }),
            makeMessage({ scId: 'message-3' }),
        ];

        expect(getMessageIndexByScId(chat)).toEqual(
            new Map([
                ['duplicate', 0],
                ['message-1', 1],
                ['message-3', 3],
            ]),
        );
        expect(
            resolveScIdsToIndices(chat, ['message-3', 'missing', 'duplicate', 'message-3']),
        ).toEqual([0, 3]);
        expect(rangesFromSortedIndices([0, 1, 3])).toEqual([
            [0, 1],
            [3, 3],
        ]);
    });

    it('ignores non-message inputs', () => {
        expect(ensureMessageScId(null)).toBeNull();
        expect(ensureMessageScId([])).toBeNull();
        expect(ensureChatScIds('not-chat')).toBe(false);
    });
});
