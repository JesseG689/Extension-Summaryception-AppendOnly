import { getChat, getSlashCommand, getSlashCommandParser } from '../foundation/context.js';
import { warn } from '../foundation/logger.js';
import { getChatStore, getCurrentSummarizedBoundary } from '../foundation/state.js';
import { migrateWorldInfoToBakeOutlet, unbakeWorldInfo } from '../core/world-info-bake.js';
import { assembleSummaryBlock } from '../features/injection.js';
import { clearSummaryceptionMemory } from '../features/memory.js';

// ─── Slash Commands ──────────────────────────────────────────────────

/**
 *
 */
export function registerSlashCommands() {
    try {
        const SlashCommandParser = getSlashCommandParser();
        const SlashCommand = getSlashCommand();

        if (!SlashCommandParser?.addCommandObject || !SlashCommand) {
            warn('SlashCommandParser not available, skipping command registration.');
            return;
        }

        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'sc-status',
                callback: () => {
                    const store = getChatStore();
                    const boundary = getCurrentSummarizedBoundary(getChat(), store);
                    const lines = ['**Summaryception Status**'];
                    lines.push(
                        boundary < 0 ? 'No summaries.' : `Current summarized boundary: ${boundary}`,
                    );
                    for (let i = 0; i < store.layers.length; i++) {
                        const layer = store.layers[i];
                        if (layer?.length > 0) {
                            lines.push(`Layer ${i}: ${layer.length} snippets`);
                        }
                    }
                    return lines.join('\n');
                },
                helpString: 'Show Summaryception layer status',
            }),
        );

        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'sc-clear',
                callback: async () => {
                    await clearSummaryceptionMemory({ updateUi: true });
                    return 'Summaryception memory cleared and messages unghosted.';
                },
                helpString: 'Clear all Summaryception memory and unghost messages for this chat',
            }),
        );

        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'sc-preview',
                callback: () => {
                    return assembleSummaryBlock() || '(No summaries yet)';
                },
                helpString: 'Preview the summary block that would be injected',
            }),
        );

        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'sc-migrate-wi',
                callback: async () => {
                    const result = await migrateWorldInfoToBakeOutlet();
                    return `Cloned ${result.books} lorebooks and migrated ${result.entries} dynamic entries to sc_bake.`;
                },
                helpString:
                    'Clone lorebooks and move their dynamic World Info entries to the Summaryception bake outlet',
            }),
        );

        SlashCommandParser.addCommandObject(
            SlashCommand.fromProps({
                name: 'sc-unbake-wi',
                callback: async () => {
                    const result = await unbakeWorldInfo();
                    return `Restored ${result.entries} entries in ${result.books} lorebooks and removed ${result.messages} baked chat messages.`;
                },
                helpString: 'Restore migrated World Info entries and remove baked chat messages',
            }),
        );
    } catch (e) {
        warn('Could not register slash commands:', e);
    }
}
