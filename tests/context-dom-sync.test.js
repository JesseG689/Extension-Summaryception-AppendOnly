import { afterEach, describe, expect, it, vi } from 'vitest';

const { synchronizeRemovedChatMessages } = await vi.importActual('../src/foundation/context.js');

const originalDocument = globalThis.document;

afterEach(() => {
    globalThis.document = originalDocument;
});

function makeRenderedMessage(index, classes = []) {
    const attributes = new Map([['mesid', String(index)]]);
    const classNames = new Set(classes);
    const label = { textContent: `#${index}` };
    return {
        removed: false,
        label,
        getAttribute: (name) => attributes.get(name) ?? null,
        setAttribute: (name, value) => attributes.set(name, value),
        querySelector: (selector) => (selector === '.mesIDDisplay' ? label : null),
        remove() {
            this.removed = true;
        },
        classList: {
            add: (name) => classNames.add(name),
            remove: (name) => classNames.delete(name),
            contains: (name) => classNames.has(name),
        },
    };
}

function installRenderedChat(messages) {
    const chatElement = {
        querySelectorAll: () => messages.filter((message) => !message.removed),
    };
    globalThis.document = {
        querySelector: (selector) => (selector === '#chat' ? chatElement : null),
    };
}

describe('rendered chat removal synchronization', () => {
    it('removes targets and renumbers displayed messages after offscreen removals', () => {
        const first = makeRenderedMessage(3);
        const removed = makeRenderedMessage(4, ['last_mes']);
        const last = makeRenderedMessage(5);
        installRenderedChat([first, removed, last]);

        expect(synchronizeRemovedChatMessages([1, 4])).toBe(true);

        expect(first.getAttribute('mesid')).toBe('2');
        expect(first.label.textContent).toBe('#2');
        expect(removed.removed).toBe(true);
        expect(last.getAttribute('mesid')).toBe('3');
        expect(last.label.textContent).toBe('#3');
        expect(first.classList.contains('last_mes')).toBe(false);
        expect(last.classList.contains('last_mes')).toBe(true);
    });

    it('reports failure when the rendered chat root is unavailable', () => {
        globalThis.document = { querySelector: () => null };

        expect(synchronizeRemovedChatMessages([1])).toBe(false);
    });
});
