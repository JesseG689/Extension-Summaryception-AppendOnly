import { MEMORY_MODES } from '../foundation/constants.js';

const MODEL_MARKERS = ['kimi', 'moonshot'];

/**
 * Replace stored assistant reasoning in the final Kimi request payload.
 * @param {unknown} generateData - Mutable CHAT_COMPLETION_SETTINGS_READY payload.
 * @param {Partial<ExtensionSettings>} settings - Effective Summaryception settings.
 * @returns {number} Number of assistant messages changed.
 */
export function replaceKimiReasoningInRequest(generateData, settings = {}) {
    if (!isPlainObject(generateData)) {
        return 0;
    }

    const payload = generateData;
    if (!isEligibleRequest(payload, settings)) {
        return 0;
    }

    const replacement = String(settings.kimiReasoningReplacement ?? '').trim();
    return replacement ? replaceMessages(payload.messages, replacement) : 0;
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
 * @returns {number}
 */
function replaceMessages(messages, replacement) {
    let replaced = 0;
    for (const message of messages) {
        if (
            !isPlainObject(message) ||
            message.role !== 'assistant' ||
            !hasStoredReasoning(message)
        ) {
            continue;
        }
        message.reasoning_content = replacement;
        delete message.reasoning;
        replaced++;
    }
    return replaced;
}
/**
 * @param {Record<string, unknown>} message
 * @returns {boolean}
 */
function hasStoredReasoning(message) {
    return typeof message.reasoning === 'string' && message.reasoning.trim().length > 0;
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
