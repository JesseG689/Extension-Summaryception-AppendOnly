/**
 * OpenVault-style prompt assemblers shared by every summarizer prompt template.
 *
 * System prompt = `<role>` + optional `<role_invariants>`.
 * User prompt   = `<input>` blocks → `<output_schema>` → `<task_rules>` →
 *                  `<critical_rules>` (omitted when empty) → bare `EXECUTION_TRIGGER` line.
 *
 * Pure functions; no settings or runtime imports.
 */

/**
 * Assemble a system prompt from a role sentence and optional role invariants.
 * @param {string} role - The role sentence.
 * @param {string} [invariants] - Role invariants block; appended only when non-empty.
 * @returns {string}
 */
export function buildSystemPrompt(role, invariants) {
    let out = `<role>\n${role}\n</role>`;
    if (typeof invariants === 'string' && invariants.length > 0) {
        out += `\n\n<role_invariants>\n${invariants}\n</role_invariants>`;
    }
    return out;
}

/**
 * Assemble a user prompt from its ordered structural blocks.
 * @param {object} args
 * @param {string} args.inputBlocks - One or more `<input>` XML blocks.
 * @param {string} args.schemaBlock - The `<output_schema>` body.
 * @param {string} args.taskRules - The `<task_rules>` body (durability + format rules).
 * @param {string} [args.criticalRules] - The `<critical_rules>` body; omitted when empty.
 * @param {string} args.triggerLine - Bare affirmative imperative line.
 * @returns {string}
 */
export function buildUserPrompt({
    inputBlocks,
    schemaBlock,
    taskRules,
    criticalRules,
    triggerLine,
}) {
    const parts = [inputBlocks, `<output_schema>\n${schemaBlock}\n</output_schema>`];
    parts.push(`<task_rules>\n${taskRules}\n</task_rules>`);
    if (typeof criticalRules === 'string' && criticalRules.length > 0) {
        parts.push(`<critical_rules>\n${criticalRules}\n</critical_rules>`);
    }
    parts.push(triggerLine);
    return parts.join('\n\n');
}

/**
 * Bare imperative line for Layer 0 generate/repair user prompts.
 */
export const EXECUTION_TRIGGER_L0 =
    'Now output the two sections ([NARRATIVE] then [STATE]) with no preamble, code fences, or commentary.';

/**
 * Bare imperative line for Layer 1+ promotion generate/repair user prompts.
 */
export const EXECUTION_TRIGGER_PROMO =
    'Now output exactly one [NARRATIVE] paragraph with no preamble, code fences, or commentary.';
