import { getChat } from '../foundation/context.js';
import { ensureChatScIds } from '../foundation/message-identity.js';
import { getChatStore } from '../foundation/state.js';
import { persistChatState } from './persist-state.js';
import { deleteNonConversationMessages } from './world-info-bake.js';

/**
 * Assign stable IDs without changing chat contents.
 * @returns {Promise<{ chat: ChatMessage[], store: SummaryceptionStore }>}
 */
export async function prepareSummaryCycle() {
    const chat = getChat();
    const assigned = ensureChatScIds(chat);
    const store = getChatStore();
    if (assigned) {
        await persistChatState();
    }
    return { chat, store };
}

/**
 * Remove temporary World Info records at an explicit summarization boundary.
 * @returns {Promise<number>}
 */
export async function cleanupSummaryCycle() {
    const deletedWorldInfoMessages = await deleteNonConversationMessages();
    if (deletedWorldInfoMessages > 0) {
        await persistChatState();
    }
    return deletedWorldInfoMessages;
}
