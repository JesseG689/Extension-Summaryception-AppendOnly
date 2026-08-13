# Append-Only Mode (Cache Strategy Redesign)

Status: **Sessions 1–3 implemented.**
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

**R10 — the fork-point rule (critical).** A longer request extends a stored
entry **iff the first appended message is `role: assistant`**. Appending
`system` or `user` as the first new message MISSes — even with a clean
role boundary, even when the parent is confirmed warm. System/user
messages are fine *after* the opening assistant. This is the strongest
predictor of cache extension, stricter than the same-role merge rule.
Empirical evidence: `CACHING.md` R10 suffix matrix, lines 108-117.

## The position argument (why this is hard)

For chat `[greet, u₁, a₁, u₂]`, compare turn N vs turn N+1 payloads with WI
injected six ways:


| Injection site              | Turn N                                                          | Turn N+1                                                                              | Result            |
| --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------- |
| System blob (mutable WI)    | `[sys(+WI), greet, u₁, a₁, u₂]`                                 | `[sys(+WI'), greet, u₁, a₁, u₂, a₂, u₃]`                                              | MISS if WI ≠ WI'  |
| depth = 1                   | `[sys, greet, u₁, a₁, INJ_N, u₂]`                               | `[sys, greet, u₁, a₁, u₂, a₂, INJ_{N+1}, u₃]`                                         | **always MISS**   |
| depth = 0                   | `[sys, greet, u₁, a₁, u₂, INJ_N]`                               | `[sys, greet, u₁, a₁, u₂, a₂, u₃, INJ_{N+1}]`                                         | **always MISS**   |
| Merged into latest user     | `[…, u₂ + INJ_N]` (last msg)                                    | `[…, u₂ (history, no INJ), a₂, u₃ + INJ_{N+1}]`                                       | **always MISS**   |
| **Baked as system message** | `[…, a₁, S_N(sys), u₂]` (frozen in chat)                        | `[…, a₁, S_N(sys), u₂, a₂, S_{N+1}(sys), u₃]`                                         | **HIT**           |
| Baked into user msg text    | `[…, u₂ + INJ_N]` (stored in chat)                              | `[…, u₂ + INJ_N (history unchanged), a₂, u₃ + INJ_{N+1}]`                             | **HIT**           |

Rows 1–4 re-inject each turn at a fixed relative position — that position
shifts as chat grows, so the byte at slot $L{-}1$ changes between turns.
Rows 5–6 **freeze** the lore as persistent chat state. Once placed, the
message is never recomputed; future turns only append after it. That is the
only property that produces HITs under a strict message-list cache.

Rows 5 and 6 both cache. Row 5 (system narrator message) is the chosen
strategy: cleaner separation, native ST support, easier flush/undo. Row 6
(mutate user message text) is kept as a fallback if row 5 turns out to be

### R10 constraint — why row 5 works and what breaks it

Row 5 places the narrator message **after the assistant reply, before the
new user message**: `…, a_N, S_{N+1}(sys), u_{N+1}`. Each turn's extension
opens with `a_N` (assistant), satisfying R10. This is the only splice
position that works:

| Splice position                  | Turn extension opens with | R10  | Cache |
| -------------------------------- | ------------------------- | ---- | ----- |
| `a_N, S, u_{N+1}` (our design)   | `a_N` (assistant)         | ✓    | HIT   |
| `S, a_N, u_{N+1}` (system first) | `S` (system)              | ✗    | MISS  |
| `a_N, u_{N+1}, S` (after user)   | `a_N` (assistant)         | ✓    | HIT   |
| `S` at start of chat             | — (cold, no parent)       | n/a  | MISS  |

The third row (`a_N, u_{N+1}, S`) also satisfies R10 but puts the lore
after the user message — semantically wrong (lore should precede the
user's input it informs). Row 1 is the only correct choice.

**Already empirically validated.** `CACHING.md` lines 119-131 report a
3-turn frozen-narrator chain (`cache_design.py` Part B) using this exact
layout. Results: turn 1 cold MISS, turns 2-3 PREFIX at 73-79% cached.
The provider has already confirmed this pattern caches.

**What would break R10:**
- Moving the narrator message before `a_N` in the payload (system-first
  extension → MISS).
- Adding a non-assistant message at the start of the turn extension
  (e.g., a depth-0 system injection that re-computes per turn).
- Removing `a_N` from the visible window (summarization flush that
  hides `a_N` but keeps `S_{N+1}` and `u_{N+1}` — the extension would
  open with `S` or `u`, MISS).

**Flush interaction with R10.** When Summaryception hides a range that
includes `a_N` but the following `S_{N+1}` and `u_{N+1}` remain visible,
the first visible message of the extension changes from assistant to
system/user. R10 is violated. Mitigation: the flush boundary must always
fall between `u_N` and `a_N` (at the user/assistant pair boundary), never
mid-pair. This is already how ST chat works — messages hide as
contiguous ranges, and our narrator messages fall inside those ranges
naturally. But the invariant must be verified during implementation.

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

Dynamic WI content is **baked as a system narrator message inserted into
chat storage** before the latest user message, so historical messages stay
byte-identical across turns. Constant WI entries stay where they are
(system blob, byte-stable, free).

The mechanism is ST's native `/sys` command (`sendNarratorMessage`,
`slash-commands.js:6019`). It splices a message with
`extra.type = system_message_types.NARRATOR` into `chat[]` at a chosen
position. `setOpenAIMessages` (`openai.js:581`) maps that type to
`role: 'system'` in the API payload. No source patch, no monkey-patch.

Why this beats baking into user message text (the previous draft strategy):
clean separation (no mutation of user-typed text), native ST support,
compact UI display via `isSmallSys`, trivial flush cleanup (delete the
messages), trivial undo (delete one message). User-text baking is kept as
a fallback if the narrator-message approach turns out to be infeasible.

### What gets baked

- World Info entries with `position = outlet` and `outletName = 'sc_bake'`.
  The user (or a one-shot migration command we ship) moves dynamic entries
  to this outlet position. Constant entries stay at `before` / `after`.
- Each activated entry's content after ST World Info regex processing. The
  bake preserves activation order and does not reuse the combined outlet text.

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

**2. Per-turn capture (listener on `WORLD_INFO_ACTIVATED`).** Stash only.
Register an `eventSource.on` listener on `WORLD_INFO_ACTIVATED`. On fire:
- Retain the activated entries for `outletName = 'sc_bake'`, ordered by
  descending `order`.
- Retain each entry's lorebook, UID, content, and depth for per-entry processing.
- Do NOT splice here. `coreChat` was snapshotted before the WI scan.

**3. Dual-mutation inject (listener on `CHAT_COMPLETION_PROMPT_READY`).**
This is the load-bearing intercept. Register a second listener on
`CHAT_COMPLETION_PROMPT_READY`. On fire (skip `dryRun`):
- Drop entries whose `(world, uid)` identity already appears in a visible
  version-2 bake marker. Continue to read legacy UID-only markers.
- Apply ST's World Info regex processing to each remaining entry.
- Wrap each result in a complete `<wi>...</wi>` block.
- Select complete blocks under both `memoryTokenBudget` and remaining provider capacity.
- **Mutation A — API payload.** Splice the system message into
  `eventData.chat` before the last `{role: 'user'}` entry. This is the
  array that becomes `generate_data.prompt` (`openai.js:1607-1614`). The
  provider sees the system message this turn.
- **Mutation B — ST chat storage.** Splice the narrator message object
  into `chat[chat.length - 1]` (ST's `chat[]`, via `getContext().chat`).
  This persists on ST's end-of-turn `saveChatConditional`. Next turn's
  `coreChat` picks it up.
- Both mutations must land the message at the equivalent position
  (before the latest user message) so the API payload and ST storage
  agree on ordering.
- **R10 constraint:** the splice MUST place the narrator message after
  the last assistant reply (`a_N, S_{N+1}, u_{N+1}`), never before it.
  The message before the last user entry is, by chat structure, always
  `a_N` (the previous turn's assistant reply). If the last user message
  is not preceded by an assistant message (first turn, or edge case),
  skip the bake — placing `S` first would violate R10.

Message object (note `is_system: false` — see Step 0 findings):

```js
{
  name: 'SC-WI',
  is_user: false,
  is_system: false,  // MUST be false — see coreChat filter below
  send_date: getMessageTimeStamp(),
  mes: _pendingBake,
  force_avatar: system_avatar,
  extra: {
    type: system_message_types.NARRATOR,  // forces role='system' in API
    gen_id: Date.now(),
    isSmallSys: true,
    api: 'summaryception',
    model: 'sc_wi_bake',
    sc_wi: { uids: capturedUids, version: 1 },
  },
}
```

**Why `is_system: false`:** ST filters `is_system: true` messages out of
`coreChat` (`script.js:4437`), which feeds `setOpenAIMessages`, which
builds the API payload. An `is_system: true` message never reaches the
API. `sendNarratorMessage` sets `is_system: false` for messages with
visible text for exactly this reason. The `extra.type = NARRATOR` flag
is what maps to `role: 'system'` in the API (`openai.js:581`), not the
`is_system` boolean.

### Step 0 findings — investigation results (resolved)

**Q3: Is `chat.splice` during `WORLD_INFO_ACTIVATED` visible to the API
payload? — NO.**

Call order (`script.js`): `coreChat = chat.filter(...)` (L4437) →
`chatForWI = coreChat.map(...)` (L4565) → `getWorldInfoPrompt(chatForWI)`
(L4576, fires `WORLD_INFO_ACTIVATED`) → `setOpenAIMessages(coreChat)`
(L4775) → `prepareOpenAIMessages` → API call.

`coreChat` is snapshotted before WI scan. Splicing into `chat[]` during
`WORLD_INFO_ACTIVATED` mutates the source array but not the snapshot.
The narrator message appears in `chat[]` (persisted for next turn) but
NOT in the current turn's `coreChat` / API payload. Result: the message
shows up one turn late, shifting the prefix every turn — permanent MISS.

**Fix:** intercept at `CHAT_COMPLETION_PROMPT_READY` (`openai.js:1610`),
which fires after the payload is built but before it ships. Mutate
`eventData.chat` (the payload) AND `chat[]` (storage) in the same
listener. Both see the message this turn; next turn's `coreChat`
includes it from storage.

**Q2: Does WI scan read narrator messages? — YES.**

WI scan can read visible narrator text. Visible `extra.sc_wi` markers suppress
rebaking the same `(world, uid)` entry. Hidden or aged-out markers do not, so
current activations can bake again after a flush. Legacy UID-only markers are
still read and conservatively suppress matching UIDs.

**Q9: Does the summarizer read narrator messages? — YES.**

The summarizer reads `chat[]` directly via `getChat()` →
`buildPassageFromRangeWithStats` (`chatutils.js:182`). It filters on
`is_system` (e.g., `isPromptVisibleLiveMessage`: `!message.is_system`,
L237). Our messages have `is_system: false`, so they pass the filter
and are included in passage text — the summary would parrot lore.

**Required integration:** add `&& !message.extra?.sc_wi` to the
filter predicates in:
- `chatutils.js`: `isPromptVisibleLiveMessage` (L237),
  `isUserHiddenMessage` (L249), `buildAssistantTurnsFromChat` (L103),
  `getPromptDepthsByChatIndex` (L143)
- `partition-planner.js` (L221), `cache-planner.js` (L237),
  `verbatim-window.js` (L237)
- `slop-breaker.js` (L106)

This is mechanical: one extra clause per predicate. No architectural
change.

### Activation tracking — short answer

We consume ST's `WORLD_INFO_ACTIVATED` result rather than running a parallel
scan. Version-2 `extra.sc_wi` metadata stores `(world, uid)` identities for
duplicate suppression, undo, and audit.

### Bake ordering — revised after Step 0

Sequence per turn (corrected):

1. User presses send.
2. `MESSAGE_SENT` fires.
3. Slash commands run; `GENERATION_AFTER_COMMANDS` fires.
4. `coreChat = chat.filter(...)` snapshots the chat array (`script.js:4437`).
5. WI scan runs on `chatForWI` (derived from `coreChat`) →
   `WORLD_INFO_ACTIVATED` fires → **our capture listener stashes the
   activated `sc_bake` entries.**
6. `setOpenAIMessages(coreChat)` builds API message list from snapshot.
7. `prepareOpenAIMessages` assembles the full prompt.
8. `CHAT_COMPLETION_PROMPT_READY` fires (`openai.js:1610`) → **our inject
   listener filters visible identities, processes and wraps each retained
   entry, then splices `eventData.chat` (payload) + `chat[]` (storage).**
9. API call. Provider sees the system message in the payload. Cache
   stores the full list.
10. Response. ST saves `chat[]` — narrator message persists.

Turn N+1: `coreChat` snapshot (step 4) includes the narrator message from
storage. `setOpenAIMessages` maps `NARRATOR` → `role: 'system'`. The
message list `[…, S_N, u_N, a_N, …]` matches turn N's payload exactly up
to the tail → HIT.

### Bake presentation — customizable system narrator message

The baked content is its own message in `chat[]`, not text appended to a
user message. ST displays it as a compact narrator message. We keep
`isSmallSys: true` and `name: 'SC-WI'` so each block remains visible for
audit without taking the space of a full chat message.

APPEND_ONLY exposes one full-message template editor in both Easy and
Advanced controls. The template supports `{{entry_count}}`, `{{entries}}`,
and native SillyTavern macros. The default uses an outer `<details>` block,
a hidden HTML-comment instruction, and seven `{{roll::1d20}}` macros: one
user roll, one assistant/NPC roll, and five Chekhov rolls. SillyTavern
expands those macros once before the identical resolved text is inserted
into the provider payload and persisted narrator message.

Each newly activated entry is a nested collapsed `<details>` block. Its
summary uses the World Info comment/title when available, or `Memory N`
otherwise. The processed entry remains bounded by `<wi>...</wi>` tags.
Entry identity is persisted in version-3 `extra.sc_wi` metadata as
`{ entries: [{ world, uid }] }`, not exposed in model-visible text.

A normal user turn always gets a block, including when no newly activated
entry remains after duplicate suppression. This guarantees that its seven
rolls exist. The adjacent persisted `extra.sc_wi` marker makes insertion
idempotent for the current user turn. Regenerate, swipe, Continue, and all
other non-normal generation paths reuse persisted content and never reroll.

### Independent bake limits

`APPEND_ONLY` mode uses two dedicated controls:

- **Max Baked WI Entries** — caps newly activated entries per turn. Default
  10; range 5–50. Highest-order entries are selected first.
- **Max Baked WI Tokens** — caps the complete baked `<world_info>` payload.
  Default 5 000; range 2 000–10 000. No entry or tag is partially truncated.

The provider-capacity check remains an additional hard limit. The existing
`memoryTokenBudget` and `verbatimTokenBudget` retain their summarization and
live-context meanings.

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
baked narrator messages in that range are hidden along with them. They
leave the visible prompt. No preservation logic. The summarizer does not
see them either (it uses `generateRaw`, bypasses WI, and must also filter
`extra.sc_wi` when reading `chat[]` directly — see *Open questions*).

This is the desired behavior. Old context (including its baked lore) ages
out of the visible window. New turns get fresh bakes from current WI
activations.

Implementation note: Summaryception's existing flush already hides
messages by index range. Narrator messages fall in those ranges
automatically. No special handling needed unless we want to filter them
out of the summarizer input explicitly.

**R10 flush invariant.** When the flush hides messages, the visible
window must still open every turn extension with an assistant message.
If a flush boundary splits an `a_N, S_{N+1}, u_{N+1}` triple — hiding
`a_N` but keeping the narrator and user message — the next turn's
extension opens with `S` or `u` (R10 violation → MISS). The flush
boundary must always fall at a user/assistant pair boundary (between
`u_N` and `a_{N-1}`), never inside a triple. See open question Q9.

### Mask user role — no race

`assistant-role-mask.js` rewrites roles on `generateData.prompt.messages`
(the in-flight prompt), not on `chat[]`. The mask runs in its
`GENERATION_AFTER_COMMANDS` listener, which fires *before* prompt
assembly. Our inject listener runs later, at
`CHAT_COMPLETION_PROMPT_READY`. By then, the mask has already finished.
Our splice into `eventData.chat` adds a `{role: 'system'}` entry — the
mask only touches `{role: 'user'}` entries, so it would not have
touched our message even if it ran later.

No race. If the mask is ever rewritten to operate on `eventData.chat`
at `CHAT_COMPLETION_PROMPT_READY`, register with `eventSource.makeLast`
to ensure our splice lands first.

## Edge cases & decisions log

1. **Existing chat history cannot be retroactively baked.** Prefix
   stability starts from the moment the user enables `APPEND_ONLY`. Old
   messages stay bare. Documented; not a bug.
2. **WI keyword cascade from baked content.** Visible bakes can participate in later scans, but their persisted identities prevent duplicate baking. Once a bake is hidden by a flush, its entries may activate and bake again.
3. **Independent bake limits.** Entry count and bake tokens have dedicated caps. Selection keeps highest-order entries first and never truncates an entry or tag.
4. **Edit/regen.** Editing a user message does not affect adjacent
   narrator messages — they are independent chat entries. Regen affects
   assistant messages; the narrator message before the user message is
   untouched. If the user deletes a baked narrator message manually,
   prefix stability breaks for that turn only (one MISS); subsequent
   turns re-stabilize on the new prefix.
5. **Quick Reply / bot-initiated sends.** Out of scope for v1. May silently
   skip the bake. Document as known limitation.
6. **Group chats.** Out of scope for v1. Behavior undefined.
7. **UI display.** Compact narrator message (`isSmallSys: true`,
   `name: 'SC-WI'`) for v1. ST's native narrator rendering. No custom
   HTML.
8. **First turn after enable.** Bake lands during current turn's WI scan.
   Current turn's prompt sees the narrator message. Cache stores it.
   Next turn extends cleanly. No special first-turn handling.
9. **Provider generality.** `APPEND_ONLY` is for list-cache providers.
   Using it on a `cache_control`-capable provider is wasteful (we pay
   full price for baked tokens that native cache would handle). The mode
   name and description must communicate this without naming specific
   providers.
10. **Summarizer input filtering.** **Resolved (Step 0).** Summarizer
    reads `chat[]` directly (`chatutils.js:182`). Our narrator messages
    (`is_system: false`) pass existing filters. **Required integration:**
    add `&& !message.extra?.sc_wi` to filter predicates in
    `chatutils.js` (L237, L249, L103, L143), `partition-planner.js`
    (L221), `cache-planner.js` (L237), `verbatim-window.js` (L237),
    `slop-breaker.js` (L106). Mechanical, no architectural change.

## Open questions for next session

**Resolved by Step 0 investigation:**
- Q2 (WI scan reads narrator messages?) → **YES.** `world-info.js:1057`.
  Cascade accepted for v1.
- Q3 (chat.splice visible during WORLD_INFO_ACTIVATED?) → **NO.**
  coreChat snapshotted before WI scan. Fixed: intercept at
  `CHAT_COMPLETION_PROMPT_READY` with dual mutation.
- Q9 (summarizer reads chat[] directly?) → **YES.** `chatutils.js:182`.
  Required: add `extra.sc_wi` filter to 7 predicates (listed in edge
  case #10).

**Still open:**

- **Q1.** Final mode names: `BALANCED` vs `DEFAULT` vs `STANDARD` for the
  small-saw mode. Bikeshed.
- **Q2.** (new) Token budget for bake: `memoryTokenBudget` is consumed
  AFTER token budgeting runs (we splice at `CHAT_COMPLETION_PROMPT_READY`,
  post-budget). Does the provider reject the request if the bake pushes
  total tokens over `openai_max_context`? Need to verify whether the
  freed budget from moving WI to outlet (tokens not consumed in system
  blob) offsets the bake tokens added post-budget. If not, we need a
  pre-budget reservation.
- **Q3.** (new) `CHAT_COMPLETION_PROMPT_READY` fires for dry runs (token
  counting) and non-chat APIs. Confirm the `dryRun` flag is reliably set
  and filter on it. Also confirm the event fires for all OpenAI-compatible
  APIs (not just `openai` source — custom sources, OOAI, etc.).
- **Q4.** Should the migration to outlet position be a one-click command
  in v1, or a documented manual step? Manual is KISS; command is UX.
- **Q5. Resolved.** Narrator messages always use `isSmallSys: true`. Compact
  presentation is fixed and has no user setting.
- **Q6.** When `memoryTokenBudget` is shared between bake and memory
  injection, does the bake consume budget first or memory? Or are
  they independent caps on independent injections? Needs a clear rule.
- **Q7.** Should `APPEND_ONLY` be selectable from the Easy mode picker, or
  Advanced only?
- **Q8.** Continue/retry idempotency: `CHAT_COMPLETION_PROMPT_READY` may
  fire multiple times for the same user message (continue, retry,
  multi-step tool calls). The idempotency guard checks
  `chat[chat.length - 2]?.extra?.sc_wi`. Verify this handles all cases
  without false positives (e.g., user sends two messages in quick
  succession).

- **Q9.** (new) Flush/R10 invariant: verify that ST's message hiding
  (Summaryception flush) always produces contiguous ranges bounded at
  user/assistant pair boundaries. If a flush hides `a_N` but keeps the
  following `S_{N+1}` and `u_{N+1}`, the turn extension opens with
  system/user → R10 violation → MISS. Must confirm the flush boundary
  never splits an `a_N, S_{N+1}, u_{N+1}` triple.

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

## Roadmap

### Session 1 — Foundation + diagnostic (no behavior change)

Mode enum cleanup:
- Remove MEMORY_MODES.CACHE. Add APPEND_ONLY. Rename STANDARD → BALANCED.
- Settings migration: mode: 'cache' → mode: 'balanced'.
- Update mode picker UI, help text.

Diagnostic tool (build first, use to verify everything else):
- Hash each prompt section per turn (system blob, each chat message, each injection).
- Log hash + diff against previous turn's hash.
- This is how we prove the bake works and catch any remaining prefix-instability sources.

End state: Modes renamed, diagnostic reports per-turn hash deltas. No bake code. Extension works exactly as before with new mode names.

### Session 2 — Core bake + summarizer filter — Complete

Summarizer filter (do this FIRST — it's mechanical and blocks safe testing):
- Add && !message.extra?.sc_wi to 7 filter predicates:
  - chatutils.js: L237, L249, L103, L143
  - partition-planner.js: L221
  - cache-planner.js: L237
  - verbatim-window.js: L237
  - slop-breaker.js: L106

Bake mechanism:
- Listener 1: WORLD_INFO_ACTIVATED → retain activated `sc_bake` entries; formatted outlet content is read later.
- Listener 2: CHAT_COMPLETION_PROMPT_READY → dual-mutation splice (payload + storage).
- Token budget cap (memoryTokenBudget), idempotency guard, dry-run skip.
- Manual WI book migration (user moves entries to outlet position).

Proof: Send chats, watch diagnostic confirm prefix hash stable, tail extends. Watch proxy logs confirm cache reuse.

End state: Bake works end-to-end with manual WI setup. Cache HIT pattern verified via diagnostic.

### Session 3 — Polish + hardening — Complete

- Added `/sc-migrate-wi` to move non-constant entries in every available lorebook to `position = outlet`, `outletName = 'sc_bake'`; original placement is stored for exact reversal.
- Added `/sc-unbake-wi` to restore migrated entries and remove persisted `SC-WI` narrator messages through SillyTavern's native delete path.
- Post-assembly baking measures the complete candidate payload, including the inserted system-message envelope, and respects remaining provider capacity plus the dedicated bake limits.
- Retry, Continue, Quick Reply, dry-run, malformed-tail, and repeated prompt-ready paths remain idempotent through the assistant/user fork guard.
- Compact narrator display is always enabled for baked lore.
- Verified flush ranges end before the baked narrator/user pair, preserving the R10 boundary.
- Added independent controls for baked entry count and baked token size.