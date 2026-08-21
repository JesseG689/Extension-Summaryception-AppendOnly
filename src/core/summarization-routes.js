import { MEMORY_MODES } from '../foundation/constants.js';
import { buildChatWindowPlan } from './chat-window-planner.js';
import { getSlopBreakerPlan } from './slop-breaker.js';

export const SUMMARY_ROUTES = Object.freeze({
    STANDARD_AUTO: 'standard-auto',
    CACHE_AUTO: 'cache-auto',
    FORCE: 'force',
    SLOP: 'slop',
});

export const SUMMARY_COMMIT_MODES = Object.freeze({
    TURNS: 'turns',
    TURNS_WITH_SOURCE_END: 'turns-with-source-end',
    ATOMIC_PARTITIONS: 'atomic-partitions',
});

const LAYER0_PHASE = /** @type {'layer0'} */ ('layer0');

/**
 * @typedef {object} SummaryRoutePlan
 * @property {string} route
 * @property {boolean} ready
 * @property {string} reason
 * @property {string} commitMode
 * @property {'layer0'} phase
 * @property {import('./chatutils.js').AssistantTurn[]} batchTurns
 * @property {import('./partition-planner.js').SourcePartition[]} partitions
 * @property {number} overflowCount
 * @property {number} totalBatches
 * @property {number} [sourceEndIdx]
 * @property {number} [targetIndex]
 * @property {object} rawPlan
 */

/**
 * Build the automatic route plan selected by the active memory mode.
 * @param {ChatMessage[]} chat
 * @param {SummaryceptionStore} store
 * @param {ExtensionSettings} settings
 * @returns {Promise<SummaryRoutePlan>}
 */
export async function buildAutoSummaryRoutePlan(chat, store, settings) {
    const plan = await buildChatWindowPlan(chat, store, settings);
    const atomic =
        settings.memoryMode === MEMORY_MODES.PREFIX_CACHE ||
        settings.memoryMode === MEMORY_MODES.APPEND_ONLY;
    if (atomic) {
        return {
            route: SUMMARY_ROUTES.CACHE_AUTO,
            ready: plan.reason === 'ready',
            reason: plan.reason,
            commitMode: SUMMARY_COMMIT_MODES.ATOMIC_PARTITIONS,
            phase: LAYER0_PHASE,
            batchTurns: plan.batchTurns,
            partitions: plan.partitions,
            overflowCount: plan.overflowCount,
            totalBatches: plan.reason === 'ready' ? plan.partitions.length : 0,
            rawPlan: plan,
        };
    }
    return buildTurnRoute({
        route: SUMMARY_ROUTES.STANDARD_AUTO,
        ready: plan.reason !== 'none',
        plan,
        batchTurns: selectLayer0BatchTurns(plan),
        totalBatches: 1,
    });
}

/**
 * Build the Force Summarize route plan.
 * @param {ChatMessage[]} chat
 * @param {SummaryceptionStore} store
 * @param {ExtensionSettings} settings
 * @returns {Promise<SummaryRoutePlan>}
 */
export async function buildForceSummaryRoutePlan(chat, store, settings) {
    const plan = await buildChatWindowPlan(chat, store, settings, { ignoreReadiness: true });
    return buildTurnRoute({
        route: SUMMARY_ROUTES.FORCE,
        ready: plan.reason !== 'none',
        plan,
        batchTurns: selectLayer0BatchTurns(plan),
        totalBatches: plan.partitions.length,
    });
}

/**
 * Build the Slop Breaker route plan.
 * @param {ChatMessage[]} chat
 * @param {SummaryceptionStore} store
 * @param {ExtensionSettings} settings
 * @param {{ targetIndex?: number }} [opts]
 * @returns {Promise<SummaryRoutePlan>}
 */
export async function buildSlopSummaryRoutePlan(chat, store, settings, opts = {}) {
    const plan = await getSlopBreakerPlan(chat, store, settings, opts);
    return {
        route: SUMMARY_ROUTES.SLOP,
        ready: plan.reason === 'ready',
        reason: plan.reason,
        commitMode: SUMMARY_COMMIT_MODES.TURNS_WITH_SOURCE_END,
        phase: LAYER0_PHASE,
        batchTurns: plan.batchTurns,
        partitions: plan.partitions,
        overflowCount: plan.eligibleTurns.length,
        totalBatches: plan.totalBatches,
        sourceEndIdx: plan.sourceEndIdx,
        targetIndex: plan.targetIndex,
        rawPlan: plan,
    };
}

function buildTurnRoute({ route, ready, plan, batchTurns, totalBatches }) {
    return {
        route,
        ready,
        reason: plan.reason,
        commitMode: SUMMARY_COMMIT_MODES.TURNS,
        phase: LAYER0_PHASE,
        batchTurns,
        partitions: plan.partitions,
        overflowCount: plan.overflowCount,
        totalBatches: ready ? Math.max(1, totalBatches) : 0,
        rawPlan: plan,
    };
}

function selectLayer0BatchTurns(plan) {
    return plan.reason === 'repair' ? plan.visibleTurns : plan.batchTurns;
}
