import { getChat } from '../foundation/context.js';
import { ensureChatScIds } from '../foundation/message-identity.js';
import { getChatStore } from '../foundation/state.js';
import { persistChatState } from './persist-state.js';
import { deleteNonConversationMessages } from './world-info-bake.js';

/**
 * Assign stable IDs and remove temporary World Info before summary planning.
 * @returns {Promise<{ chat: ChatMessage[], store: SummaryceptionStore }>}
 */
export async function prepareSummaryCycle() {
    let chat = getChat();
    const assignedBeforeCleanup = ensureChatScIds(chat);
    const deletedWorldInfoMessages = await deleteNonConversationMessages();

    chat = getChat();
    const assignedAfterCleanup = ensureChatScIds(chat);
    const store = getChatStore();
    if (assignedBeforeCleanup || assignedAfterCleanup || deletedWorldInfoMessages > 0) {
        await persistChatState();
    }

    return { chat, store };
}
