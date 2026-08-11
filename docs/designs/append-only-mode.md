# Append-Only Mode (Cache Strategy Redesign)

Status: **Draft — brainstorm output, not approved for implementation.**
Last revised: 2026-08-11.

This is a working document. Open questions are first-class citizens; nothing
here is a final decision until it gets resolved in a follow-up session.

## References

- Provider cache model and measurements: `C:\tmp\test_proxy\CACHING.md`
- SillyTavern WI source: `C:\projects\_rp\SillyTavern\public\scripts\world-info.js`
- SillyTavern prompt assembly: `C:\projects\_rp\SillyTavern\public\scripts\openai.js`
- Extension state ownership: `agent_docs/architecture/architecture.md`

## Background — the cache model in one paragraph

The target provider caches by **exact message list**. Next turn HITs iff the
prior request is a byte-exact leading sub-list of the new request. Cost:
$$\text{uncached} + 0.10 \cdot \text{cached}$$
HIT = the prior list is a prefix of the new one (extension).
MISS = no stored list is a leading sub-list (full price).

**There is no partial hit.** Adding to the tail = HIT. Changing anything in
the prefix = MISS. Same-role adjacent messages are merged upstream, so any
layout producing consecutive user-role or assistant-role messages is
re-keyed at the provider regardless of what ST sends.

## The position argument (why this is hard)

For chat `[greet, u₁, a₁, u₂]`, compare turn N vs turn N+1 payloads with WI
injected four ways:

| Injection site              | Turn N                                                          | Turn N+1                                                                              | Result            |
| --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------- |
| System blob (mutable WI)    | `[sys(+WI), greet, u₁, a₁, u₂]`                                 | `[sys(+WI'), greet, u₁, a₁, u₂, a₂, u₃]`                                              | MISS if WI ≠ WI'  |
| depth = 1                   | `[sys, greet, u₁, a₁, INJ_N, u₂]`                               | `[sys, greet, u₁, a₁, u₂, a₂, INJ_{N+1}, u₃]`                                         | **always MISS**   |
| depth = 0                   | `[sys, greet, u₁, a₁, u₂, INJ_N]`                               | `[sys, greet, u₁, a₁, u₂, a₂, u₃, INJ_{N+1}]`                                         | **always MISS**   |
| Merged into latest user     | `[…, u₂ + INJ_N]` (last msg)                                    | `[…, u₂ (history, no INJ), a₂, u₃ + INJ_{N+1}]`                                       | **always MISS**   |
| **Baked into user msg text**| `[…, u₂ + INJ_N]` (stored in chat)                              | `[…, u₂ + INJ_N (history unchanged), a₂, u₃ + INJ_{N+1}]`                             | **HIT**           |

Only the last row preserves the prefix. The bake must land in `chat[i].mes`
as persistent chat state, not as a prompt-time injection.

## Mode redesign — clean cut, no legacy

Three modes, selected by user. The existing `MEMORY_MODES.CACHE` (verbatim
budget = 32000 + protected tail) is **removed**. No compatibility shim.

| Mode         | Verbatim window   | Sawtooth shape | Cache strategy                                              |
| ------------ | ----------------- | -------------- | ----------------------------------------------------------- |
| `BALANCED`   | ~22 000 (current) | Small saw      | None. Summarize to stay in effective model range.           |
| `PREFIX_CACHE` | ~32 000         | Wide saw       | Large stable verbatim prefix; relies on provider prefix cache. |
| `APPEND_ONLY` | (n/a — see below) | Driven by bake | Bake dynamic content into chat history so prefix is byte-stable. |

**Naming — open question.** `BALANCED` vs `DEFAULT` for the small-saw mode.
`BALANCED` describes what it does (balances context size vs summarization
cost). `DEFAULT` is honest about its role (it is the default) but says
nothing about behavior. Leaning `BALANCED`. Other candidate: `STANDARD`.
Mode enum names below use `BALANCED` as a placeholder — bikeshed in review.

```js
// proposed enum (foundation/constants.js)
export const MEMORY_MODES = Object.freeze({
    BALANCED: 'balanced',
    PREFIX_CACHE: 'prefix_cache',
    APPEND_ONLY: 'append_only',
});
```

**Provider fit (informational, not a gate):**
- `BALANCED` — any provider.
- `PREFIX_CACHE` — providers with native prefix caching (OpenAI, Anthropic
  with `cache_control`, Gemini). Larger stable prefix = more cache reuse.
- `APPEND_ONLY` — providers that cache by exact message list and reject
  `cache_control` (kimi-k3, possibly others). The bake is mandatory here
  because nothing else keeps the prefix stable.

## APPEND_ONLY mode — the bake strategy

Dynamic WI content is **baked into the user message text in chat storage**
so that historical messages stay byte-identical across turns. Constant WI
entries stay where they are (system blob, byte-stable, free).

### What gets baked

- World Info entries with `position = outlet` and `outletName = 'sc_bake'`.
  The user (or a one-shot migration command we ship) moves dynamic entries
  to this outlet position. Constant entries stay at `before` / `after`.
- The formatted WI text ST already produces for the outlet, read from
  `extension_prompts['customWIOutlet_sc_bake']`. ST applies the user's
  `wi_format` template before populating this; we reuse that, we do not
  reformat.

### What does NOT get baked

- Constant WI entries.
- Author's Note.
- Summaryception's own memory injection (handled separately — see below).
- Time / date macros in the main prompt. (Out of scope; user must keep
  these stable manually for APPEND_ONLY to work.)

### Intercept — four components

**1. One-time WI book migration.** Dynamic entries move to
`position = outlet, outletName = 'sc_bake'`. Reversible via ST's WI editor.
A `/sc-migrate-wi` slash command can bulk-rewrite entries; tracked as
optional polish, not a v1 requirement.

**2. Per-turn capture.** Register an `eventSource.on` listener on
`WORLD_INFO_ACTIVATED`. On fire (skip dry-run scans):
- Read `getContext().extensionPrompts['customWIOutlet_sc_bake']?.value`.
- Stash in a module-local `_pendingBake`.

**3. Bake into the latest user message.** Same handler, synchronously:
- Find `chat[chat.length - 1]` (the message just sent).
- Wrap bake text in HTML comments to keep chat UI clean (see *Bake
  presentation* below).
- Mutate `chat[i].mes = original + '\n\n' + bakeBlock`.
- The mutation lands during WI scan (which runs *inside* prompt assembly,
  before `populateChatHistory` reads `chat`). Subsequent assembly steps
  see the baked text and ship it to the API. ST persists the mutation on
  the next `saveChatConditional`. No explicit save needed.

**4. Track + undo.** For each baked message, record in
`chat_metadata.sc_wi_bakes`:

```js
{
  [messageIndex]: {
    uids: number[],          // WI entry uids that fired this turn
    baked_text: string,      // exact bytes appended
    original_mes: string,    // user's typed text, for undo
    timestamp: string,
  }
}
```

A `/sc-unbake-wi` slash command walks the map, restores `original_mes`,
clears the record. Useful if the user wants to migrate off the mode or
recover from a runaway bake.

### Activation tracking — short answer

We do not run a parallel WI scan. We consume ST's. `WORLD_INFO_ACTIVATED`
is the single source of truth; we are a sink. Per-message persistence in
`chat_metadata.sc_wi_bakes` is for undo and audit, not for re-evaluation.

### Bake ordering — clarify

User asked: "first we bake lorebook shit inside prompt THEN send to LLM,
right?" — Yes. Sequence per turn:

1. User presses send.
2. `MESSAGE_SENT` fires.
3. Slash commands run; `GENERATION_AFTER_COMMANDS` fires with `generateData`.
4. Prompt assembly begins. WI scan runs as part of assembly.
5. **WI scan completes → `WORLD_INFO_ACTIVATED` fires.**
6. **Our handler runs synchronously: capture + mutate `chat[i].mes`.**
7. Assembly continues (`populateChatHistory`, `populationInjectionPrompts`,
   mask user role) — reads the already-baked `chat[i].mes`.
8. `CHAT_COMPLETION_PROMPT_READY` fires. Mask has already run by this point.
9. API call. Provider sees baked text. Cache stores the full message list.
10. Response. ST persists `chat[i]` with baked text intact.

Future turns: `chat[i]` is byte-stable in history. Latest user message is
the only thing that changes. Prefix extends → HIT.

### Bake presentation — HTML comments

Bake block wrapped in HTML comments so the rendered chat UI does not show
raw WI text to the user:

```
<!--SC-WI-BAKE-START-->
[outlet content here]
<!--SC-WI-BAKE-END-->
```

ST's chat renderer passes HTML through (markdown → HTML). HTML comments are
invisible in the rendered DOM. The bake is present in `chat[i].mes` (for
the API and the cache) but absent from what the user sees.

`<details><summary>WI</summary>…</details>` is the alternative — visible
but collapsed. Heavier and more visually intrusive. HTML comments preferred
for v1; `<details>` could be a user toggle later.

**Open question — WI scan re-entry.** WI scan reads `chat[i].mes` to find
keywords. If our baked content contains those keywords, future scans see
them permanently. This causes cascading activation (bake makes everything
stickier than sticky). Two possible fixes; need to investigate which ST
supports:
- HTML comments may be stripped by ST's WI scan input pre-processing. If
  so, putting bake in comments hides it from the scan as a side effect.
- If not, we need to filter `chat[i].mes` before WI scan sees it, which
  means intercepting the scan input. Likely requires a small monkey-patch
  on `getWorldInfoPrompt` or `WorldInfoBuffer`. **Investigate first.**

### Settings reuse — no new sliders

`APPEND_ONLY` mode does not introduce new budget controls. It reuses:

- **`memoryTokenBudget`** — hard cap on the baked WI text appended per
  turn. If captured outlet content exceeds this, truncate to the most
  recently activated entries (highest `order` first) until under budget.
- **`verbatimTokenBudget`** — in `APPEND_ONLY`, this controls the same
  thing it does in `BALANCED` (the live-context token ceiling that
  triggers summarization). Unchanged semantics.

One existing slider (`memoryTokenBudget`) gets a second hat. Documented in
its help text and the mode help block. No new DOM.

### Summary memory injection in APPEND_ONLY mode

Separate problem, same shape. Summaryception's own memory injection
(`setExtensionPrompt(MODULE_NAME, …)`) is mutable too. In `APPEND_ONLY`,
the injection must also be byte-stable between flushes or it breaks the
prefix the same way WI does.

Current proposal: in `APPEND_ONLY`, memory updates are **pinned to flush
events**. The injected text only changes when a flush completes. Between
flushes, the system blob (constant WI + main prompt + memory block) is
byte-stable. Cost: one MISS per flush, unavoidable because the summary
text itself changes.

Position: stays at `IN_PROMPT` (inside system blob). Moving to
`BEFORE_PROMPT` is an option if the main system message is also stable;
otherwise it just moves the instability. Default `IN_PROMPT`.

### Flush interaction — what happens to baked WI

User clarification: when Summaryception flushes (hides old messages), the
baked WI in those hidden messages is **deleted from the visible prompt**.
No preservation logic. The summary captures what the summarizer sees; if
it does not see baked WI (it does not, because the summarizer uses
`generateRaw` and bypasses WI), the summary does not contain it.

This is the desired behavior. Old context (including its baked WI) ages
out of the visible window. New turns get fresh bakes from current WI
activations.

### Mask user role — no race

`assistant-role-mask.js` rewrites roles on `generateData.prompt.messages`
(the in-flight prompt), not on `chat[i].mes`. The mask reads the assembled
messages, which were built from our already-baked `chat[i].mes`. So the
mask sees baked text and rewrites roles consistently.

No persisted-state race. The only ordering constraint is the existing one:
the mask runs in its `GENERATION_AFTER_COMMANDS` listener; WI scan and our
bake run during prompt assembly, which fires later. So by the time the
mask runs, the bake is already in place. Safe.

If the mask is ever rewritten to operate on `chat[i]` directly, this
reasoning needs revisiting.

## Edge cases & decisions log

1. **Existing chat history cannot be retroactively baked.** Prefix
   stability starts from the moment the user enables `APPEND_ONLY`. Old
   messages stay bare. Documented; not a bug.
2. **WI keyword cascade from baked content.** See *Bake presentation —
   open question*. Must be resolved before implementation.
3. **Token budget reuse.** `memoryTokenBudget` caps bake size. Truncation
   policy: highest `order` first. Documented in mode help.
4. **Edit/regen.** Editing a baked message preserves the bake (it is just
   text in `chat[i].mes`). Regen affects assistant messages, not user
   message text — bake is unaffected.
5. **Quick Reply / bot-initiated sends.** Out of scope for v1. May silently
   skip the bake. Document as known limitation.
6. **Group chats.** Out of scope for v1. Behavior undefined.
7. **UI display.** HTML comments for v1. `<details>` as future option.
8. **First turn after enable.** Bake lands during current turn's WI scan.
   Current turn's prompt sees baked text. Cache stores it. Next turn
   extends cleanly. No special first-turn handling.
9. **Provider generality.** `APPEND_ONLY` is for list-cache providers.
   Using it on a `cache_control`-capable provider is wasteful (we pay
   full price for baked tokens that native cache would handle). The mode
   name and description must communicate this without naming specific
   providers.

## Open questions for next session

- **Q1.** Final mode names: `BALANCED` vs `DEFAULT` vs `STANDARD` for the
  small-saw mode. Bikeshed.
- **Q2.** Does ST's WI scan strip HTML comments from its keyword input?
  Determines whether the cascade problem solves itself or needs an
  intercept. **Blocking — investigate before any code.**
- **Q3.** Does `WORLD_INFO_ACTIVATED` fire synchronously enough that our
  `chat[i].mes` mutation is visible to subsequent prompt-assembly steps?
  Verify on first integration. If not, fall back to a
  `CHAT_COMPLETION_PROMPT_READY` listener with `makeLast`.
- **Q4.** Should the migration to outlet position be a one-click command
  in v1, or a documented manual step? Manual is KISS; command is UX.
- **Q5.** Does the bake text need a leading/trailing separator beyond the
  HTML comment markers? E.g., a blank line before/after for visual
  cleanliness in the API payload. Cosmetic but worth deciding.
- **Q6.** When `memoryTokenBudget` is shared between bake and memory
  injection, does the bake consume budget first or does memory? Or are
  they independent caps on independent injections? Needs a clear rule.
- **Q7.** Should `APPEND_ONLY` be selectable from the Easy mode picker, or
  Advanced only? It is opinionated and not always the right choice.
- **Q8.** How does the bake interact with continuing an interrupted
  generation? `Continue` re-sends the same user message; bake should be
  idempotent on second fire (do not double-bake).

## Non-goals (explicit)

- Real-time cache-hit telemetry from `usage.prompt_tokens_details`. ST
  does not surface the API `usage` object to extensions. Out of scope
  without a server-side piece.
- Replacing the WI scan itself. ST's scan remains the source of truth.
- Supporting depth-positioned WI in `APPEND_ONLY`. Always MISS regardless
  of bake; document as "do not use."
- Preserving baked WI through summarization flush. Bakes are deleted with
  the messages that hold them.
- Group chat support in v1.
