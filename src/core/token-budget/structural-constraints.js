export const STATE_KEY_CEILING = 7;

// Tokens the model averages per short, direct RP sentence. Used only to convert
// a backend token bound into a countable sentence cap; never shown to the model.
export const TOKENS_PER_SENTENCE = 35;

// Per-layer backend acceptance bands, as multiples of the slider target T.
// Layer 0 = chat->L0 (direct summarizer). Layer 1 = L0->L1 promotion. Layer 2+ = L1->L2+.
export const LAYER_MIN_RATIO = { l0: 0.4, l1: 0.4, l2: 0.3 };
export const LAYER_HARD_MAX_RATIO = { l0: 1.5, l1: 1.75, l2: 1.5 };
// Grace ceiling for Layer 0 near-miss repair (replaces 1.65 ratio).
export const LAYER0_REPAIR_RATIO = 1.65;
// Model-facing safety multiplier applied to the hard max before converting to
// a sentence cap, so a first attempt that reaches the cap still validates.
// Promotions (l1/l2) run a tighter multiplier to hold folds to 4-5 sentences,
// keeping first-pass output well inside the backend hard-max window.
export const LAYER_SAFETY_MULTIPLIER = { l0: 0.85, l1: 0.5, l2: 0.5 };

/**
 * Maximum number of `[STATE]` key:value lines the model should emit.
 * @param {number | undefined} sourceStateKeyCount - Keys present in the prior snapshot.
 * @returns {number}
 */
export function computeStateLineCap(sourceStateKeyCount) {
    const count = Number(sourceStateKeyCount);
    if (!Number.isFinite(count) || count <= 0) {
        return STATE_KEY_CEILING;
    }
    return Math.min(count, STATE_KEY_CEILING);
}

// Normalize a layer key to 'l0' | 'l1' | 'l2'. Accepts a number (promotion
// layerIndex) or a string; anything >= 1 is a deep layer.
function layerKey(layer) {
    if (layer === 'l0' || layer === 0) {
        return 'l0';
    }
    if (layer === 'l1') {
        return 'l1';
    }
    return 'l2'; // 'l2' or any promotion layerIndex >= 1
}

/**
 * Integer sentence cap for a layer, anchored to slider target T.
 * cap = floor(hardMaxRatio * T * safetyMultiplier / TOKENS_PER_SENTENCE), min 1.
 * @param {'l0' | 'l1' | 'l2' | number} layer - Layer key or promotion layerIndex.
 * @param {number | undefined} targetTokens - Slider target T.
 * @returns {number}
 */
export function computeSentenceCap(layer, targetTokens) {
    const key = layerKey(layer);
    const t = Number(targetTokens);
    if (!Number.isFinite(t) || t <= 0) {
        return 1;
    }
    const raw = Math.floor(
        (LAYER_HARD_MAX_RATIO[key] * t * LAYER_SAFETY_MULTIPLIER[key]) / TOKENS_PER_SENTENCE,
    );
    return Math.max(1, raw);
}
