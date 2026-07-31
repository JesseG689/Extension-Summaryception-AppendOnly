# Summarizer Engine, Memory & Connections

## Memory Model & Compaction
- **Layer 0**: Summarizes turns outside the verbatim window into `[NARRATIVE]` + rolling `[STATE]` snapshot (`stateMode: snapshot-v1`). Prompt memory injection uses only the newest `[STATE]`.
- **STATE Snapshot & Deterministic Compaction**:
  - Target: 500 tokens (soft), 600 tokens (hard max).
  - Deterministic compaction (`compactStateSnapshotText`) runs in-process to trim oversized state blocks down to ~2,640 chars without pre-filter magnitude gates.
  - Per-category soft char limits (`STATE_CATEGORY_CHAR_BUDGET`) run independently; `current_date_time` (rank -1) is exempt and carried verbatim.
- **Layer 1+ Promotions**:
  - Merges older snippets into deeper layers when layer snippet limits (`snippetsPerLayer`) are breached.
  - Target bounds anchored to target $T$: L1 outputs land in $0.4T \le t \le 1.75T$, L2+ in $0.3T \le t \le 1.5T$.
  - Snapshot sources use the final snapshot in the promoted span.

## Prompts & Constraint Assembly
- **Prompt Assembler**: `src/core/prompt-parts.js` structures prompts (`buildSystemPrompt`, `buildUserPrompt`). Order: `<input>` -> `<output_schema>` -> `<task_rules>` -> `<critical_rules>` -> `EXECUTION_TRIGGER`.
- **Trigger Line Invariant**: The bare imperative trigger MUST be the final line. Dynamic blocks (`<summaryception_source_budget>`, repair feedback) are inserted *above* the trigger via `insertBeforeTrigger()`.
- **Budget Hints & Constraints**:
  - `src/core/token-budget/` generates `<summaryception_source_budget>`. Speaks only in model-countable units (sentences, lines)—never tokens or percentages.
  - `computeSentenceCap(layer, T)` derives sentence limits.
  - `{{state_schema}}` resolves dynamically via `buildStateSchemaText()` from enabled modular state categories.
- **Prose Dates**: `[NARRATIVE]` uses calendar dates only (`On July 6`). No years, ISO syntax, or clock lead-ins.
- **Weekday Auto-Correction**: `parseSnippet` normalizes `current_date_time` ISO weekdays deterministically in UTC via `normalizeCurrentDateTime`.

## Connections & Routing
- **Adapters**: `src/core/connection-*.js` managed by `connectionutil.js`.
- **Failover & Retries**: Exponential backoff. Hard network errors (`failed to fetch`) bypass primary retries to trigger fallback routes immediately.
- **SSE Streaming**: OpenAI streaming must reach `data: [DONE]`; early disconnects are retryable.
- **Timeouts**: Configured in seconds per route (`requestTimeoutSeconds`, `mergeRequestTimeoutSeconds`, `fallbackRequestTimeoutSeconds`). Retries run at 75% of initial attempt timeout.

## Injection & Ghosting
- **Injection**: Standard placement uses `setExtensionPrompt()`. Macro Only mode uses `{{summaryception_memory}}`. `injectCurrentState` controls whether `[CURRENT STATE]` is prepended to prompt memory.
- **Ghosting**: Hides native chat via `/hide`. Owned turns marked with `extra.sc_ghosted` and tracked in `store.ghostedIndices`. Clearing uses `/unhide` strictly on owned messages.
