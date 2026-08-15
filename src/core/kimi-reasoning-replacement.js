import { MEMORY_MODES } from '../foundation/constants.js';

const MODEL_MARKERS = ['kimi', 'moonshot'];
/** @type {WeakMap<object, Array<{ content: unknown, replacement: string }>>} */
const assignedReplacements = new WeakMap();

/**
 * Seed assistant history in the final Kimi request payload. Once assigned, a
 * message keeps its seed so setting edits affect only newly appended history.
 * @param {unknown} generateData - Mutable CHAT_COMPLETION_SETTINGS_READY payload.
 * @param {Partial<ExtensionSettings>} settings - Effective Summaryception settings.
 * @param {object} [scope] - Stable identity for the active chat.
 * @returns {number} Number of assistant messages changed.
 */
export function replaceKimiReasoningInRequest(generateData, settings = {}, scope = generateData) {
    if (!isPlainObject(generateData)) {
        return 0;
    }

    const payload = generateData;
    if (!isEligibleRequest(payload, settings)) {
        return 0;
    }

    const replacement = String(settings.kimiReasoningReplacement ?? '').trim();
    return replacement ? replaceMessages(payload.messages, replacement, scope) : 0;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {Partial<ExtensionSettings>} settings
 * @returns {payload is Record<string, unknown> & { messages: unknown[] }}
 */
function isEligibleRequest(payload, settings) {
    return Boolean(
        settings.enabled &&
        settings.memoryMode === MEMORY_MODES.APPEND_ONLY &&
        settings.replaceKimiReasoning &&
        isCustomSource(payload.chat_completion_source) &&
        matchesKimiModel(payload.model) &&
        !payload.json_schema &&
        !(Array.isArray(payload.tools) && payload.tools.length > 0) &&
        Array.isArray(payload.messages),
    );
}

/**
 * @param {unknown[]} messages
 * @param {string} replacement
 * @param {object} scope
 * @returns {number}
 */
function replaceMessages(messages, replacement, scope) {
    const history = /** @type {Record<string, unknown>[]} */ (
        messages.filter(
            (message, index) =>
                isPlainObject(message) &&
                message.role === 'assistant' &&
                index !== messages.length - 1,
        )
    );
    const prior = assignedReplacements.get(scope) || [];
    const overlap = findSuffixPrefixOverlap(prior, history);
    const assigned = history.map(
        (message, index) =>
            prior[prior.length - overlap + index] || {
                content: message.content,
                replacement,
            },
    );

    for (let index = 0; index < history.length; index++) {
        history[index].reasoning_content = assigned[index].replacement;
        delete history[index].reasoning;
    }
    assignedReplacements.set(scope, assigned);
    return history.length;
}

/**
 * @param {Array<{ content: unknown, replacement: string }>} prior
 * @param {Record<string, unknown>[]} history
 * @returns {number}
 */
function findSuffixPrefixOverlap(prior, history) {
    for (let length = Math.min(prior.length, history.length); length > 0; length--) {
        const offset = prior.length - length;
        if (
            history
                .slice(0, length)
                .every((message, index) => prior[offset + index].content === message.content)
        ) {
            return length;
        }
    }
    return 0;
}

/**
 * @param {unknown} model
 * @returns {boolean}
 */
function matchesKimiModel(model) {
    const normalized = String(model ?? '').toLowerCase();
    return MODEL_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * @param {unknown} source
 * @returns {boolean}
 */
function isCustomSource(source) {
    return String(source ?? '').toLowerCase() === 'custom';
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
