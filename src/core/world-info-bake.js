import { MEMORY_MODES } from '../foundation/constants.js';
import { getChat, getContext, renderInsertedChatMessage } from '../foundation/context.js';
import { getEffectiveSettings } from '../foundation/state.js';
import { countTextTokens } from './token-count.js';

const BAKE_OUTLET_NAME = 'sc_bake';
const BAKE_OUTLET_KEY = `customWIOutlet_${BAKE_OUTLET_NAME}`;

let pendingUids = [];

/**
 * Remember which activated entries belong to Summaryception's bake outlet.
 * The formatted outlet prompt is populated after this event, so content is read at prompt-ready time.
 * @param {unknown} activatedEntries
 * @returns {void}
 */
export function captureWorldInfoBake(activatedEntries) {
    pendingUids = Array.isArray(activatedEntries)
        ? activatedEntries
              .filter((entry) => isBakeOutletEntry(entry))
              .sort((left, right) => getEntryOrder(right) - getEntryOrder(left))
              .map((entry) => getEntryUid(entry))
              .filter((uid) => uid !== null)
        : [];
}

/**
 * Insert the current bake into both the final API payload and persistent chat storage.
 * @param {unknown} eventData
 * @param {unknown} [dryRun]
 * @returns {Promise<boolean>} Whether a bake was inserted.
 */
export async function injectPendingWorldInfoBake(eventData, dryRun = false) {
    try {
        const isDryRun = dryRun === true || getEventDryRun(eventData);
        if (isDryRun || getEffectiveSettings().memoryMode !== MEMORY_MODES.APPEND_ONLY) {
            return false;
        }

        const prompt = getPromptChat(eventData);
        const chat = getChat();
        if (!prompt || !hasAssistantUserTail(chat) || chat.at(-2)?.extra?.sc_wi) {
            return false;
        }

        const userPromptIndex = findLastUserPromptIndex(prompt);
        const outletText = getBakeOutletText();
        if (userPromptIndex < 0 || !outletText.trim() || pendingUids.length === 0) {
            return false;
        }

        const content = await capBakeText(outletText, getEffectiveSettings().memoryTokenBudget);
        if (!content.trim()) {
            return false;
        }

        const marker = { uids: [...pendingUids], version: 1 };
        prompt.splice(userPromptIndex, 0, { role: 'system', content });
        const narrator = createNarratorMessage(content, marker);
        chat.splice(chat.length - 1, 0, narrator);
        renderInsertedChatMessage(narrator, chat.length - 2);
        return true;
    } finally {
        pendingUids = [];
    }
}

function isBakeOutletEntry(entry) {
    return Boolean(entry && typeof entry === 'object' && entry.outletName === BAKE_OUTLET_NAME);
}

function getEntryOrder(entry) {
    const order = Number(entry?.order);
    return Number.isFinite(order) ? order : 0;
}

function getEntryUid(entry) {
    const uid = entry?.uid;
    return typeof uid === 'string' || typeof uid === 'number' ? uid : null;
}

function getEventDryRun(eventData) {
    return Boolean(eventData && typeof eventData === 'object' && eventData.dryRun === true);
}

function getPromptChat(eventData) {
    if (!eventData || typeof eventData !== 'object' || !Array.isArray(eventData.chat)) {
        return null;
    }
    return eventData.chat;
}

function hasAssistantUserTail(chat) {
    return (
        Array.isArray(chat) &&
        chat.length >= 2 &&
        chat.at(-1)?.is_user === true &&
        chat.at(-2)?.is_user === false &&
        chat.at(-2)?.is_system === false &&
        !chat.at(-2)?.extra?.sc_wi
    );
}

function findLastUserPromptIndex(prompt) {
    return prompt.findLastIndex((message) => message?.role === 'user');
}

function getBakeOutletText() {
    const value = getContext().extensionPrompts?.[BAKE_OUTLET_KEY]?.value;
    return typeof value === 'string' ? value : '';
}

async function capBakeText(text, budget) {
    const limit = Math.max(0, Math.floor(Number(budget) || 0));
    if (limit === 0 || (await countTextTokens(text)).count <= limit) {
        return limit === 0 ? '' : text;
    }

    let low = 0;
    let high = text.length;
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if ((await countTextTokens(text.slice(0, middle))).count <= limit) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    return text.slice(0, low).trimEnd();
}

function createNarratorMessage(content, marker) {
    return {
        name: 'SC-WI',
        is_user: false,
        is_system: false,
        send_date: new Date().toISOString(),
        mes: content,
        force_avatar: 'img/five.png',
        extra: {
            type: 'narrator',
            gen_id: Date.now(),
            isSmallSys: true,
            api: 'summaryception',
            model: 'sc_wi_bake',
            sc_wi: marker,
        },
    };
}
