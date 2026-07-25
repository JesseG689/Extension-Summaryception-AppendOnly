import { describe, expect, it } from 'vitest';

import { ConnectionError } from '../src/core/connection-error.js';
import {
    isLocalUrl,
    normalizeOpenAIEndpoint,
    tryExtractChatContent,
} from '../src/core/connection-transport.js';

describe('ConnectionError', () => {
    it('defaults to a non-retryable error with a null status', () => {
        const err = new ConnectionError('boom');
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe('ConnectionError');
        expect(err.message).toBe('boom');
        expect(err.retryable).toBe(false);
        expect(err.status).toBeNull();
    });

    it('honors explicit retryable and status options', () => {
        const err = new ConnectionError('rate limited', { retryable: true, status: 429 });
        expect(err.retryable).toBe(true);
        expect(err.status).toBe(429);
    });
});

describe('isLocalUrl', () => {
    it.each([
        'http://localhost:8080',
        'http://127.0.0.1',
        'http://192.168.1.5',
        'http://10.0.0.1',
        'http://172.16.0.1',
        'http://172.31.255.255',
    ])('classifies %s as local', (url) => {
        expect(isLocalUrl(url)).toBe(true);
    });

    it.each([
        'https://api.example.com',
        // 172.15 and 172.32 sit just outside the private 172.16-31 band.
        'http://172.15.0.1',
        'http://172.32.0.1',
    ])('classifies %s as non-local', (url) => {
        expect(isLocalUrl(url)).toBe(false);
    });
});

describe('normalizeOpenAIEndpoint', () => {
    it('strips trailing slashes and appends /v1/chat/completions to a bare host', () => {
        expect(normalizeOpenAIEndpoint('https://api.example.com/')).toBe(
            'https://api.example.com/v1/chat/completions',
        );
    });

    it('appends /chat/completions when the base ends with /v1', () => {
        expect(normalizeOpenAIEndpoint('https://api.example.com/v1')).toBe(
            'https://api.example.com/v1/chat/completions',
        );
    });

    it('leaves an already-complete /chat/completions URL unchanged', () => {
        expect(normalizeOpenAIEndpoint('https://api.example.com/v1/chat/completions')).toBe(
            'https://api.example.com/v1/chat/completions',
        );
    });

    it('trims a trailing slash on an already-complete URL', () => {
        expect(normalizeOpenAIEndpoint('https://api.example.com/v1/chat/completions/')).toBe(
            'https://api.example.com/v1/chat/completions',
        );
    });
});

describe('tryExtractChatContent', () => {
    it.each([[null], [undefined], [42], ['string']])(
        'returns null for a non-object input (%s)',
        (input) => {
            expect(tryExtractChatContent(input)).toBeNull();
        },
    );

    it('returns a top-level content string directly', () => {
        expect(tryExtractChatContent({ content: 'hello' })).toBe('hello');
    });

    it('falls back to message.content', () => {
        expect(tryExtractChatContent({ message: { content: 'from message' } })).toBe(
            'from message',
        );
    });

    it('falls back to choices[0].message.content then choices[0].delta.content', () => {
        expect(
            tryExtractChatContent({ choices: [{ message: { content: 'choice message' } }] }),
        ).toBe('choice message');
        expect(tryExtractChatContent({ choices: [{ delta: { content: 'choice delta' } }] })).toBe(
            'choice delta',
        );
    });

    it('returns null when no candidate is a string', () => {
        expect(tryExtractChatContent({ content: 123 })).toBeNull();
        expect(tryExtractChatContent({ choices: 'not-an-array' })).toBeNull();
    });

    it('prefers a top-level content string over message.content', () => {
        expect(
            tryExtractChatContent({ content: 'top wins', message: { content: 'message loses' } }),
        ).toBe('top wins');
    });
});
