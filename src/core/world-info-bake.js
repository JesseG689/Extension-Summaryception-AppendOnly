import { MEMORY_MODES } from '../foundation/constants.js';
import { debug } from '../foundation/logger.js';
import {
    countPromptPayloadTokens,
    expandSillyTavernMacros,
    getChat,
    getPromptTokenCapacity,
    getWorldInfoNames,
    loadWorldInfo,
    processWorldInfoText,
    reloadCurrentChat,
    renderInsertedChatMessage,
    saveChat,
    saveWorldInfo,
} from '../foundation/context.js';
import { getEffectiveSettings } from '../foundation/state.js';
import { countTextTokens } from './token-count.js';

const BAKE_OUTLET_NAME = 'sc_bake';
const BAKE_ENTRY_TAG = 'wi';
const ENTRY_COUNT_SENTINEL = '__SC_ENTRY_COUNT__';
const ENTRIES_SENTINEL = '__SC_ENTRIES__';
const TEMPLATE_ENTRY_COUNT = '{{entry_count}}';
const TEMPLATE_ENTRIES = '{{entries}}';

const WORLD_INFO_OUTLET_POSITION = 7;
const MIGRATION_MARKER = 'summaryceptionBake';
let pendingEntries = [];
let generationType = 'normal';

/**
 * Record the SillyTavern generation type that owns the next World Info activation.
 * @param {unknown} type
 * @returns {void}
 */
export function setWorldInfoBakeGenerationType(type) {
    generationType = String(type || 'normal').toLowerCase();
}

/**
 * Remember which activated entries belong to Summaryception's bake outlet.
 * @param {unknown} activatedEntries
 * @returns {void}
 */
export function captureWorldInfoBake(activatedEntries) {
    pendingEntries = Array.isArray(activatedEntries)
        ? activatedEntries
              .filter((entry) => isBakeOutletEntry(entry))
              .sort((left, right) => getEntryOrder(right) - getEntryOrder(left))
              .map(toPendingEntry)
              .filter(Boolean)
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
        if (isDryRun) {
            debug('WI bake skipped: dry run');
            return false;
        }
        if (generationType !== 'normal') {
            debug(`WI bake skipped: generation type is ${generationType}`);
            return false;
        }
        if (settings.memoryMode !== MEMORY_MODES.APPEND_ONLY) {
            debug(`WI bake skipped: effective mode is ${settings.memoryMode}`);
            return false;
        }
        const prompt = getPromptChat(eventData);
        const chat = getChat();

        if (!prompt) {
            debug('WI bake skipped: prompt-ready payload has no chat array');
            return false;
        }
        if (hasCurrentTurnBake(chat)) {
            debug('WI bake skipped: current user turn already has a persisted system block');
            return false;
        }
        if (!hasAssistantUserTail(chat)) {
            debug(
                'WI bake skipped: stored chat tail is not assistant/user',
                describeChatTail(chat),
            );
            return false;
        }

        const userPromptIndex = findLastUserPromptIndex(prompt);
        if (userPromptIndex < 0) {
            debug('WI bake skipped: final prompt has no user message');
            return false;
        }

        const entries = pendingEntries.filter((entry) => !wasEntryBaked(entry, chat));
        const protectedTemplate = String(settings.appendOnlySystemBlockTemplate)
            .replaceAll(TEMPLATE_ENTRY_COUNT, ENTRY_COUNT_SENTINEL)
            .replaceAll(TEMPLATE_ENTRIES, ENTRIES_SENTINEL);
        const expandedTemplate = (await expandSillyTavernMacros(protectedTemplate))
            .replaceAll(ENTRY_COUNT_SENTINEL, TEMPLATE_ENTRY_COUNT)
            .replaceAll(ENTRIES_SENTINEL, TEMPLATE_ENTRIES);

        const selected = await selectBakeEntries({
            entries,
            entryLimit: settings.maxBakedWorldInfoEntries,
            textBudget: settings.bakedWorldInfoTokenBudget,
            prompt,
            insertIndex: userPromptIndex,
            template: expandedTemplate,
        });
        const content = renderSystemBlock(
            expandedTemplate,
            selected.map((entry) => entry.block),
        );
        if ((await countTextTokens(content)).count > settings.bakedWorldInfoTokenBudget) {
            debug('WI bake skipped: system block template exceeds the available token budget');
            return false;
        }

        const marker = {
            entries: selected.map((entry) => ({ world: entry.world, uid: entry.uid })),
            version: 3,
        };
        prompt.splice(userPromptIndex, 0, { role: 'system', content });
        const narrator = createNarratorMessage(content, marker);
        chat.splice(chat.length - 1, 0, narrator);
        renderInsertedChatMessage(narrator, chat.length - 2);
        debug(
            `WI system block inserted: ${marker.entries.length} new entries, ${content.length} characters, prompt block ${userPromptIndex}`,
        );
        return true;
    } finally {
        pendingEntries = [];
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
 * Delete temporary and non-conversation messages from the full active chat.
 * @returns {Promise<number>} Number of deleted messages.
 */
export async function deleteNonConversationMessages() {
    const chat = getChat();
    const conversation = chat.filter(isConversationMessage);
    const deleted = chat.length - conversation.length;
    if (deleted === 0) {
        return 0;
    }

    chat.splice(0, chat.length, ...conversation);
    await saveChat();
    await reloadCurrentChat();
    return deleted;
}

function isConversationMessage(message) {
    if (message?.is_user === true) {
        return true;
    }
    if (
        !message?.mes?.trim() ||
        message?.extra?.sc_wi ||
        message?.name === 'SC-WI' ||
        message?.extra?.type
    ) {
        return false;
    }
    if (message?.is_system !== true) {
        return true;
    }
    return Array.isArray(message?.swipes);
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

    const messages = await deleteNonConversationMessages();
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

function toPendingEntry(entry) {
    const uid = getEntryUid(entry);
    if (uid === null || typeof entry?.content !== 'string' || !entry.content.trim()) {
        return null;
    }
    return {
        uid,
        world: typeof entry.world === 'string' ? entry.world : '',
        content: entry.content,
        title: typeof entry.comment === 'string' ? entry.comment.trim() : '',
        depth: Number.isFinite(Number(entry.depth)) ? Number(entry.depth) : null,
    };
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

function hasCurrentTurnBake(chat) {
    return Boolean(chat?.at(-1)?.is_user === true && chat?.at(-2)?.extra?.sc_wi);
}

function hasAssistantUserTail(chat) {
    return (
        Array.isArray(chat) &&
        chat.length >= 2 &&
        chat.at(-1)?.is_user === true &&
        chat.at(-2)?.is_user === false &&
        chat.at(-2)?.is_system !== true &&
        !chat.at(-2)?.extra?.sc_wi
    );
}

function describeChatTail(chat) {
    return Array.isArray(chat)
        ? chat.slice(-3).map((message) => ({
              name: message?.name,
              is_user: message?.is_user,
              is_system: message?.is_system,
              type: message?.extra?.type,
              sc_wi: Boolean(message?.extra?.sc_wi),
          }))
        : chat;
}

function findLastUserPromptIndex(prompt) {
    return prompt.findLastIndex((message) => message?.role === 'user');
}

function wasEntryBaked(entry, chat) {
    return chat.some((message) => {
        const marker = message?.extra?.sc_wi;
        if (Array.isArray(marker?.entries)) {
            return marker.entries.some(
                (baked) => baked?.uid === entry.uid && baked?.world === entry.world,
            );
        }
        return Array.isArray(marker?.uids) && marker.uids.includes(entry.uid);
    });
}

async function selectBakeEntries({
    entries,
    entryLimit,
    textBudget,
    prompt,
    insertIndex,
    template,
}) {
    const maxEntries = Math.max(0, Math.floor(Number(entryLimit) || 0));
    const limit = Math.max(0, Math.floor(Number(textBudget) || 0));
    const capacity = getPromptTokenCapacity();
    const selected = [];
    const candidate = { role: 'system', content: renderSystemBlock(template, []) };
    prompt.splice(insertIndex, 0, candidate);
    try {
        for (const entry of entries) {
            if (selected.length >= maxEntries) {
                break;
            }
            const processed = (await processWorldInfoText(entry.content, entry.depth)).trim();
            if (!processed) {
                continue;
            }
            const title = escapeHtml(entry.title || `Memory ${selected.length + 1}`);
            const block = `<details>\n<summary>${title}</summary>\n<${BAKE_ENTRY_TAG}>\n${processed}\n</${BAKE_ENTRY_TAG}>\n</details>`;
            const nextContent = renderSystemBlock(template, [
                ...selected.map((item) => item.block),
                block,
            ]);
            if ((await countTextTokens(nextContent)).count > limit) {
                continue;
            }
            const previousContent = candidate.content;
            candidate.content = nextContent;
            if (capacity !== null) {
                const fullCount = await countPromptPayloadTokens(prompt);
                if (fullCount === null || fullCount > capacity) {
                    candidate.content = previousContent;
                    continue;
                }
            }
            selected.push({ ...entry, block });
        }
        return selected;
    } finally {
        prompt.splice(insertIndex, 1);
    }
}
function renderSystemBlock(template, blocks) {
    return String(template)
        .replaceAll(TEMPLATE_ENTRY_COUNT, String(blocks.length))
        .replaceAll(TEMPLATE_ENTRIES, blocks.join('\n'));
}

function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
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
