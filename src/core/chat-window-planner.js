import { getCurrentSummarizedBoundary } from '../foundation/state.js';
import {
    countProcessedMessage,
    getPromptDepthsByChatIndex,
    isSummarizerConversationMessage,
    iterateChatRange,
} from './chatutils.js';
import { buildLayer0Partitions } from './partition-planner.js';
import { addBudgetStats, createBudgetStats } from './token-count.js';

/**
 * @typedef {object} ChatWindowPlan
 * @property {'ready' | 'force' | 'repair' | 'none'} reason
 * @property {number} sourceStartIdx
 * @property {number} queuedEndIdx
 * @property {number} verbatimStartIdx
 * @property {import('./chatutils.js').AssistantTurn[]} visibleTurns
 * @property {import('./chatutils.js').AssistantTurn[]} eligibleTurns
 * @property {import('./chatutils.js').AssistantTurn[]} batchTurns
 * @property {import('./partition-planner.js').SourcePartition[]} partitions
 * @property {number} overflowCount
 * @property {number} softOverflowCount
 * @property {number} visibleTurnCount
 * @property {import('./token-count.js').BudgetStats} liveStats
 * @property {import('./token-count.js').BudgetStats} verbatimStats
 * @property {import('./token-count.js').BudgetStats} queuedStats
 * @property {number} liveTokens
 * @property {number} verbatimTokens
 * @property {number} queuedTokens
 * @property {number} verbatimBudget
 * @property {number} queuedBudget
 * @property {boolean} tokenBudgetExceeded
 */

/**
 * Build one explicit A/B chat window plan for every automatic memory mode.
 * @param {ChatMessage[]} chat
 * @param {SummaryceptionStore} store
 * @param {ExtensionSettings} settings
 * @param {{ ignoreReadiness?: boolean }} [opts]
 * @returns {Promise<ChatWindowPlan>}
 */
export async function buildChatWindowPlan(chat, store, settings, { ignoreReadiness = false } = {}) {
    const boundary = getCurrentSummarizedBoundary(chat, store);
    const sourceStartIdx = boundary + 1;
    const data = await collectLiveData(chat, sourceStartIdx, settings);
    const verbatimBudget = Number(settings.verbatimTokenBudget) || 0;
    const queuedBudget = Number(settings.queuedTokenBudget) || 0;
    const tokenBudgetExceeded = data.liveStats.finalTokens >= verbatimBudget + queuedBudget;
    const verbatimStartIdx = findVerbatimStart(data.entries, verbatimBudget, sourceStartIdx);
    const eligibleTurns = data.visibleTurns.filter((turn) => turn.index < verbatimStartIdx);
    const queuedEndIdx = eligibleTurns.at(-1)?.index ?? -1;
    const verbatimStats = getEntryStats(data.entries, verbatimStartIdx, chat.length - 1);
    const queuedStats = getEntryStats(data.entries, sourceStartIdx, queuedEndIdx);
    const empty = (reason = /** @type {ChatWindowPlan['reason']} */ ('none')) =>
        buildPlan({
            reason,
            sourceStartIdx,
            queuedEndIdx,
            verbatimStartIdx,
            visibleTurns: data.visibleTurns,
            eligibleTurns,
            partitions: [],
            liveStats: data.liveStats,
            verbatimStats,
            queuedStats,
            verbatimBudget,
            queuedBudget,
            tokenBudgetExceeded,
        });

    if (data.entries.length === 0 || sourceStartIdx >= chat.length) {
        return empty();
    }

    if (ignoreReadiness) {
        const forceTurns = data.visibleTurns;
        const lastForceTurn = forceTurns.at(-1);
        if (!lastForceTurn) {
            return empty();
        }
        return await buildReadyPlan({
            reason: 'force',
            chat,
            settings,
            sourceStartIdx,
            queuedEndIdx: lastForceTurn.index,
            verbatimStartIdx,
            visibleTurns: data.visibleTurns,
            eligibleTurns: forceTurns,
            liveStats: data.liveStats,
            verbatimStats,
            queuedStats: getEntryStats(data.entries, sourceStartIdx, lastForceTurn.index),
            verbatimBudget,
            queuedBudget,
            tokenBudgetExceeded,
        });
    }

    if (!tokenBudgetExceeded) {
        return empty();
    }
    if (eligibleTurns.length === 0) {
        return empty('repair');
    }
    const latestEntry = data.entries.at(-1);
    if (
        !latestEntry ||
        latestEntry.message.is_user ||
        eligibleTurns.length < settings.minSummaryTurns
    ) {
        return empty();
    }

    return await buildReadyPlan({
        reason: 'ready',
        chat,
        settings,
        sourceStartIdx,
        queuedEndIdx,
        verbatimStartIdx,
        visibleTurns: data.visibleTurns,
        eligibleTurns,
        liveStats: data.liveStats,
        verbatimStats,
        queuedStats,
        verbatimBudget,
        queuedBudget,
        tokenBudgetExceeded,
    });
}

/**
 * @typedef {{ index: number, message: ChatMessage, stats: import('./token-count.js').CountedBudgetMessage }} LiveEntry
 * @typedef {{ entries: LiveEntry[], liveStats: import('./token-count.js').BudgetStats, visibleTurns: import('./chatutils.js').AssistantTurn[] }} LiveData
 * @typedef {Omit<ChatWindowPlan, 'batchTurns' | 'partitions' | 'overflowCount' | 'softOverflowCount' | 'visibleTurnCount' | 'liveTokens' | 'verbatimTokens' | 'queuedTokens'> & { chat: ChatMessage[], settings: ExtensionSettings }} ReadyPlanData
 */

/**
 * @param {ChatMessage[]} chat
 * @param {number} sourceStartIdx
 * @param {ExtensionSettings} settings
 * @returns {Promise<LiveData>}
 */
async function collectLiveData(chat, sourceStartIdx, settings) {
    const liveStats = createBudgetStats();
    const entries = [];
    const visibleTurns = [];
    const promptDepths = getPromptDepthsByChatIndex(chat);

    for (const { index, message } of iterateChatRange(chat, sourceStartIdx, chat.length - 1)) {
        if (!isSummarizerConversationMessage(message)) {
            continue;
        }
        const stats = await countProcessedMessage(message, promptDepths.get(index), settings);
        addBudgetStats(liveStats, stats);
        entries.push({ index, message, stats });
        if (!message.is_user) {
            visibleTurns.push({
                index,
                mes: String(message.mes),
                name: message.name || 'Assistant',
            });
        }
    }
    return { entries, liveStats, visibleTurns };
}

/**
 * @param {LiveEntry[]} entries
 * @param {number} budget
 * @param {number} fallback
 * @returns {number}
 */
function findVerbatimStart(entries, budget, fallback) {
    let tokens = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        tokens += entry.stats.finalTokens;
        if (tokens >= budget) {
            return entry.index;
        }
    }
    return entries[0]?.index ?? fallback;
}

/**
 * @param {LiveEntry[]} entries
 * @param {number} startIdx
 * @param {number} endIdx
 * @returns {import('./token-count.js').BudgetStats}
 */
function getEntryStats(entries, startIdx, endIdx) {
    const stats = createBudgetStats();
    if (endIdx < startIdx) {
        return stats;
    }
    for (const entry of entries) {
        if (entry.index >= startIdx && entry.index <= endIdx) {
            addBudgetStats(stats, entry.stats);
        }
    }
    return stats;
}

/**
 * @param {ReadyPlanData} data
 * @returns {Promise<ChatWindowPlan>}
 */
async function buildReadyPlan(data) {
    const partitions = await buildLayer0Partitions({
        chat: data.chat,
        sourceStartIdx: data.sourceStartIdx,
        assistantTurns: data.eligibleTurns,
        settings: data.settings,
        finalSourceEndIdx: data.queuedEndIdx,
    });
    return buildPlan({ ...data, partitions });
}

function buildPlan({
    reason,
    sourceStartIdx,
    queuedEndIdx,
    verbatimStartIdx,
    visibleTurns,
    eligibleTurns,
    partitions,
    liveStats,
    verbatimStats,
    queuedStats,
    verbatimBudget,
    queuedBudget,
    tokenBudgetExceeded,
}) {
    const batchTurns = partitions[0]?.turns || [];
    return {
        reason,
        sourceStartIdx,
        queuedEndIdx,
        verbatimStartIdx,
        visibleTurns,
        eligibleTurns,
        batchTurns,
        partitions,
        overflowCount: eligibleTurns.length,
        softOverflowCount: Math.max(0, eligibleTurns.length - batchTurns.length),
        visibleTurnCount: visibleTurns.length,
        liveStats,
        verbatimStats,
        queuedStats,
        liveTokens: liveStats.finalTokens,
        verbatimTokens: verbatimStats.finalTokens,
        queuedTokens: queuedStats.finalTokens,
        verbatimBudget,
        queuedBudget,
        tokenBudgetExceeded,
    };
}
