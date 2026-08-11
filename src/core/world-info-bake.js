import { MEMORY_MODES } from '../foundation/constants.js';
import {
    countPromptPayloadTokens,
    deleteChatMessage,
    getChat,
    getContext,
    getPromptTokenCapacity,
    getWorldInfoNames,
    loadWorldInfo,
    renderInsertedChatMessage,
    saveWorldInfo,
} from '../foundation/context.js';
import { getEffectiveSettings } from '../foundation/state.js';
import { countTextTokens } from './token-count.js';

const BAKE_OUTLET_NAME = 'sc_bake';
const BAKE_OUTLET_KEY = `customWIOutlet_${BAKE_OUTLET_NAME}`;

const WORLD_INFO_OUTLET_POSITION = 7;
const MIGRATION_MARKER = 'summaryceptionBake';
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
        const settings = getEffectiveSettings();
        if (isDryRun || settings.memoryMode !== MEMORY_MODES.APPEND_ONLY) {
            return false;
        }

        const prompt = getPromptChat(eventData);
        const chat = getChat();
        if (!prompt || !hasAssistantUserTail(chat)) {
            return false;
        }

        const userPromptIndex = findLastUserPromptIndex(prompt);
        const outletText = getBakeOutletText();
        if (userPromptIndex < 0 || !outletText.trim() || pendingUids.length === 0) {
            return false;
        }

        const content = await capBakeForPrompt(
            outletText,
            settings.memoryTokenBudget,
            prompt,
            userPromptIndex,
        );
        if (!content.trim()) {
            return false;
        }

        const marker = { uids: [...pendingUids], version: 1 };
        prompt.splice(userPromptIndex, 0, { role: 'system', content });
        const narrator = createNarratorMessage(content, marker, settings.compactBakes);
        chat.splice(chat.length - 1, 0, narrator);
        renderInsertedChatMessage(narrator, chat.length - 2);
        return true;
    } finally {
        pendingUids = [];
    }
}

/**
 * Move dynamic entries in all available lorebooks to the bake outlet.
 * @returns {Promise<{ books: number, entries: number }>}
 */
export async function migrateWorldInfoToBakeOutlet() {
    return await rewriteWorldInfoEntries((entry) => {
        if (entry.constant || entry.position === WORLD_INFO_OUTLET_POSITION) {
            return false;
        }
        const extensions = getEntryExtensions(entry);
        extensions[MIGRATION_MARKER] = {
            position: entry.position,
            outletName: entry.outletName,
        };
        entry.position = WORLD_INFO_OUTLET_POSITION;
        entry.outletName = BAKE_OUTLET_NAME;
        return true;
    });
}

/**
 * Restore migrated lorebook entries and delete baked narrator messages from this chat.
 * @returns {Promise<{ books: number, entries: number, messages: number }>}
 */
export async function unbakeWorldInfo() {
    const result = await rewriteWorldInfoEntries((entry) => {
        const extensions = isRecord(entry.extensions) ? entry.extensions : null;
        const marker =
            extensions && isRecord(extensions[MIGRATION_MARKER])
                ? extensions[MIGRATION_MARKER]
                : null;
        if (!marker) {
            return false;
        }
        entry.position = marker.position;
        if (marker.outletName === undefined) {
            delete entry.outletName;
        } else {
            entry.outletName = marker.outletName;
        }
        delete extensions[MIGRATION_MARKER];
        return true;
    });

    let messages = 0;
    const chat = getChat();
    for (let index = chat.length - 1; index >= 0; index--) {
        if (chat[index]?.extra?.sc_wi && (await deleteChatMessage(index))) {
            messages++;
        }
    }
    return { ...result, messages };
}

async function rewriteWorldInfoEntries(rewrite) {
    let books = 0;
    let entries = 0;
    for (const name of getWorldInfoNames()) {
        const data = await loadWorldInfo(name);
        if (!data || !isRecord(data.entries)) {
            continue;
        }
        let changed = 0;
        for (const entry of Object.values(/** @type {Record<string, unknown>} */ (data.entries))) {
            if (isRecord(entry) && rewrite(entry)) {
                changed++;
            }
        }
        if (changed > 0 && (await saveWorldInfo(name, data))) {
            books++;
            entries += changed;
        }
    }
    return { books, entries };
}

function getEntryExtensions(entry) {
    if (!isRecord(entry.extensions)) {
        entry.extensions = {};
    }
    return entry.extensions;
}

function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

async function capBakeForPrompt(text, textBudget, prompt, insertIndex) {
    const budgeted = await capBakeText(text, textBudget);
    const capacity = getPromptTokenCapacity();
    if (!budgeted || capacity === null) {
        return budgeted;
    }

    const candidate = { role: 'system', content: budgeted };
    prompt.splice(insertIndex, 0, candidate);
    try {
        const fullCount = await countPromptPayloadTokens(prompt);
        if (fullCount === null) {
            return '';
        }
        if (fullCount <= capacity) {
            return budgeted;
        }

        let low = 0;
        let high = budgeted.length;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            candidate.content = budgeted.slice(0, middle);
            const count = await countPromptPayloadTokens(prompt);
            if (count !== null && count <= capacity) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        return budgeted.slice(0, low).trimEnd();
    } finally {
        prompt.splice(insertIndex, 1);
    }
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

function createNarratorMessage(content, marker, compact) {
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
            isSmallSys: compact !== false,
            api: 'summaryception',
            model: 'sc_wi_bake',
            sc_wi: marker,
        },
    };
}
