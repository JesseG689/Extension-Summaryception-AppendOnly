# Summaryception Architecture Review & Simplification Roadmap

## 1. Executive Summary

This roadmap defines a simplification and refactoring plan for the Summaryception extension under **clean-cut assumptions** (new chat initialization with modern SillyTavern APIs, with no backwards-compatibility shims or legacy migration paths).

### Primary Objectives
- **Reduce Architectural Complexity**: Eliminate dual-state settings models, middleman orchestrator modules, and heuristic fallback guessing.
- **Enforce DRY (Don't Repeat Yourself)**: Consolidate duplicated token math across planning engines and unified settings binding in the UI layer.
- **Remove Obsolete & Fragile Logic**: Drop multi-path filesystem probing, local storage caches for runtime modules, and synthetic generation dry-runs.
- **Strengthen Reliability**: Replace multi-step formatters and fragile regex checks with deterministic contracts and single-pass parsers.

---

## 2. Architectural Audit & Identified Inefficiencies

### 2.1 Parallel Settings Model (`easy*` vs Standard)
`ExtensionSettings` maintains parallel field definitions for identical underlying concepts:
- `easySummarizerContextTokens` vs `advancedModelContext` / `maxL0SourceTokens`
- `easyMemoryTokenBudget` vs `memoryTokenBudget`
- `easyMemoryMode` vs `memoryMode`
- `easyConnectionSource` vs `connectionSource`
- `easyConnectionProfileId` vs `connectionProfileId`
- `easyMergeConnectionSource` vs `mergeConnectionSource`
- `easyMergeConnectionProfileId` vs `mergeConnectionProfileId`

**Impact**: Causes code duplication across `constants.js`, `state.js`, `settings.html`, `ui.js`, `ui-events.js`, `ui-connection.js`, and `types/globals.d.ts`. Every runtime access requires mapping via `getEffectiveSettings()`, and user setting edits risk desynchronization.

### 2.2 Duplicated Message Token Counting Across Planners
The planning loop that applies regex scripts, formats speaker labels, and counts tokens for individual chat messages is implemented identically across three separate modules:
1. `src/core/verbatim-window.js` (`countBudgetMessage`)
2. `src/core/cache-planner.js` (`countLiveMessage`)
3. `src/core/partition-planner.js` (`countSourceMessage`)

Each file re-implements:
```javascript
const rawText = String(message.mes || '').trim();
const finalText = settings.applyRegexScripts
    ? await applyRegexToMessage(rawText, Boolean(message.is_user), depth)
    : rawText;
const rawLine = getMessageLine(message, rawText);
const finalLine = getMessageLine(message, finalText);
const tokens = await countMessageTokens(message, rawLine, finalLine);
```
`getMessageLine(message, text)` is also defined 3 times identically.

### 2.3 Fragmentation of Token Budget & Repair Feedback
Logic governing token limits, sentence caps, repair feedback, and diagnostics is split across 7 separate files:
- `src/core/token-budget/structural-constraints.js`
- `src/core/token-budget/budget-hint-builder.js`
- `src/core/token-budget/repair-feedback-adapter.js`
- `src/core/token-budget/source-token-counter.js`
- `src/core/layer0-compression.js`
- `src/core/repair-diagnostics.js`
- `src/core/prompts.js`

This separation requires multi-pass string manipulations, such as string-replacing closing XML tags to inject feedback blocks inside other feedback blocks.

### 2.4 Orchestration Middlemen
`summarizer-auto.js` (16 lines) and `summarizer-manual.js` (48 lines) exist purely as thin pass-through wrappers delegating between `summarizer.js` and `summarizer-engine.js`.

### 2.5 Outdated Dynamic Path Probing & Legacy Checks
- `src/core/regex-proxy.js` iterates through relative directory paths (`../../../../regex/engine.js`, `../../../regex/engine.js`, `/scripts/extensions/regex/engine.js`) and caches path strings in `localStorage`. Standard SillyTavern uses `/scripts/extensions/regex/engine.js` directly.
- `src/core/world-info-bake.js` retains pre-v3 checks (`marker.uids` vs `marker.entries`).
- `src/entry/ui-connection.js` contains a manual REST API fallback (`fetchProfilesFallback`) for legacy SillyTavern versions without `ConnectionManagerRequestService`.

### 2.6 Heuristic Implicit State Guessing
`src/core/summarizer-state.js` contains 50+ lines of fallback logic (`findImplicitStateBoundary`, `isPlausibleImplicitStateBlock`, `extractImplicitStateLines`) designed to guess if unstructured text is a state snapshot when the `[STATE]` header is missing. Modern prompts enforce explicit headers, and `prompts.js` already validates structural integrity and triggers repair retries when headers are omitted.

### 2.7 Manual DOM Synchronization Boilerplate
`src/entry/ui.js` contains over 50 lines of explicit jQuery `.val()` and `.prop('checked')` assignments that are duplicated in both `updateUI()` and `syncSettingsInputs()`.

### 2.8 Synthetic `ctx.generate()` Dry-Run Simulation
`src/foundation/context.js` implements `captureMainPromptPayload()`, which invokes `ctx.generate('normal', ..., true)` to capture prompt payloads for a UI calculator button. This creates complex timeout management, abort controller tracking, and event listener lifecycle overhead.

---

## 3. Actionable 5-Session Refactoring Roadmap

```
Session 1: Settings Architecture & Legacy Elimination
 ├── 1.1 Unify Easy vs Advanced Settings Model
 ├── 1.2 Simplify regex-proxy.js
 ├── 1.3 Remove Legacy WI Format Checks
 └── 1.4 Remove Manual Connection Profile API Fallback

Session 2: Core Token Math & Planning Deduplication (DRY)
 ├── 2.1 Consolidate Message Processing & Token Counting
 └── 2.2 Unify Token Budget & Constraint Modules

Session 3: Pipeline & State Parser Simplification
 ├── 3.1 Inline Middleman Orchestration Files
 ├── 3.2 Streamline Repair Diagnostics & Feedback Assembly
 └── 3.3 Eliminate Heuristic State Parsing

Session 4: UI & DOM Binding Modernization
 ├── 4.1 Declarative Data-Attribute DOM Sync
 └── 4.2 Deduplicate Manual Input Assignments

Session 5: Dry-Run & Prompt Inspection Cleanup
 ├── 5.1 Remove Synthetic ctx.generate() Dry-Run Simulation
 ├── 5.2 Streamline LLM Context Preview
 └── 5.3 Standardize Defensive Event Guards
```

---

## 4. Session Implementation Specifications

### Session 1: Settings Architecture & Legacy Elimination

#### 1.1 Unify Settings Schema
- **Target Files**: `src/foundation/constants.js`, `src/foundation/state.js`, `settings.html`, `types/globals.d.ts`, `src/entry/ui.js`, `src/entry/ui-events.js`, `src/entry/ui-connection.js`.
- **Changes**:
  - Remove all `easy*` properties from `defaultSettings` and `ExtensionSettings`.
  - Maintain a single canonical field for each configuration item (`memoryMode`, `connectionSource`, `memoryTokenBudget`, etc.).
  - `uiMode` (`'off' | 'easy' | 'advanced'`) controls only DOM view presentation.
  - Easy-mode controls write directly to canonical setting fields (e.g. the Easy context slider writes to `advancedModelContext`, which automatically derives L0 source caps).
  - Simplify `getEffectiveSettings()` to apply only mode-level enable gating.

#### 1.2 Streamline `src/core/regex-proxy.js`
- Remove candidate path loops, error collection arrays, and `localStorage` caching logic.
- Import directly from `/scripts/extensions/regex/engine.js` with a single fallback to raw text if unresolvable.

#### 1.3 Remove Legacy World Info Handling
- In `src/core/world-info-bake.js`, remove the legacy `marker.uids` array check in `wasEntryBaked()`, standardizing exclusively on `marker.entries`.

#### 1.4 Remove REST Profile Fetch Fallback
- In `src/entry/ui-connection.js`, remove `fetchProfilesFallback()` and rely directly on `ConnectionManagerRequestService.handleDropdown()`.

---

### Session 2: Core Token Math & Planning Deduplication (DRY)

#### 2.1 Unified Message Counting Helper
- **Target File**: `src/core/chatutils.js` (or `src/core/token-count.js`).
- **Implementation**:
  ```javascript
  export function formatMessageSpeakerLine(message, text) {
      return `${message.is_user ? 'Player' : 'Assistant'}: ${text}`;
  }

  export async function countProcessedMessage(message, depth, settings) {
      const rawText = String(message.mes || '').trim();
      const finalText = settings.applyRegexScripts
          ? await applyRegexToMessage(rawText, Boolean(message.is_user), depth)
          : rawText;
      const rawLine = formatMessageSpeakerLine(message, rawText);
      const finalLine = formatMessageSpeakerLine(message, finalText);
      const tokens = await countMessageTokens(message, rawLine, finalLine);

      return {
          rawTokens: tokens.rawTokens,
          finalTokens: tokens.finalTokens,
          rawTokensEstimated: tokens.rawTokensEstimated,
          finalTokensEstimated: tokens.finalTokensEstimated,
          changed: rawLine !== finalLine,
      };
  }
  ```
- Replace duplicated counting loops in:
  - `src/core/verbatim-window.js` (`countBudgetMessage`)
  - `src/core/cache-planner.js` (`countLiveMessage`)
  - `src/core/partition-planner.js` (`countSourceMessage`)

#### 2.2 Consolidate `src/core/token-budget/`
- Merge the 4 micro-files in `src/core/token-budget/` into `src/core/token-budget.js`:
  - Ratios and constraints (`LAYER_HARD_MAX_RATIO`, `STATE_KEY_CEILING`).
  - Constraint calculations (`computeSentenceCap`, `computeStateLineCap`).
  - Budget hint formatting (`buildLayer0BudgetHint`, `buildSizeTargetLine`).
  - Source token counting (`getSourceTokenCount`, `countLayer0SourceBudget`).

---

### Session 3: Pipeline & State Parser Simplification

#### 3.1 Inline Middleman Orchestrators
- Delete `src/core/summarizer-auto.js` and `src/core/summarizer-manual.js`.
- Move auto-cycle execution and manual task runners (`runCatchup`, `runSlopBreaker`) directly into `src/core/summarizer-engine.js` and export standard interfaces via `src/core/summarizer.js`.

#### 3.2 Streamline Repair Diagnostics & Feedback
- Combine `src/core/repair-diagnostics.js` and `src/core/token-budget/repair-feedback-adapter.js` into a unified `src/core/repair-diagnostics.js`.
- Generate complete repair XML tags in a single pass without substring replacement of closing tags.

#### 3.3 Simplify `src/core/summarizer-state.js`
- Remove `findImplicitStateBoundary`, `isPlausibleImplicitStateBlock`, and `extractImplicitStateLines`.
- Simplify `parseSnippet()`:
  ```javascript
  export function parseSnippet(text) {
      const source = normalizeStructuralHeaderLines(text).trim();
      if (!source) {
          return { narrative: '', state: {} };
      }

      const stateIndex = source.search(/^\s*\[STATE\]\s*$/im);
      if (stateIndex === -1) {
          return { narrative: stripNarrativeHeader(source), state: {} };
      }

      const narrativeText = source.slice(0, stateIndex);
      const stateText = source.slice(stateIndex);
      return {
          narrative: stripNarrativeHeader(narrativeText),
          state: parseStateLines(stateText.split(/\r?\n/).slice(1)),
      };
  }
  ```

---

### Session 4: UI & DOM Binding Modernization

#### 4.1 Declarative Data-Attribute DOM Sync
- **Target File**: `src/entry/ui-bind.js`.
- **Implementation**:
  ```javascript
  export function syncAllSettingsToDOM(settings = getEffectiveSettings()) {
      $('[data-sc-setting]').each(function () {
          const $el = $(this);
          const key = $el.attr('data-sc-setting');
          if (!key || !(key in settings)) {
              return;
          }

          if ($el.is(':checkbox')) {
              $el.prop('checked', Boolean(settings[key]));
          } else if ($el.is('select, textarea, input')) {
              $el.val(settings[key] ?? '');
          }
      });
      syncSliderSettingPairs(SETTING_SLIDER_SELECTOR, settings);
  }
  ```

#### 4.2 Eliminate Manual Input Assignment Lists
- Update `settings.html` to ensure every configurable input element carries its corresponding `data-sc-setting` attribute.
- In `src/entry/ui.js`, replace repetitive `.val()` / `.prop()` chains in `updateUI()` and `syncSettingsInputs()` with a single call to `syncAllSettingsToDOM(s)`.

---

### Session 5: Dry-Run & Prompt Inspection Simplification

#### 5.1 Remove Synthetic `ctx.generate()` Dry-Run Simulation
- **Target File**: `src/foundation/context.js`.
- Remove `captureMainPromptPayload()`, `createDryRunTimeout()`, and `estimateMainPromptTokens()`.
- Eliminate the temporary event listeners and promise racing attached to `GENERATE_AFTER_DATA`.

#### 5.2 Streamline Context Preview UI
- In `settings.html` and `src/entry/ui.js`, remove the calculator icon button (`#sc_estimate_main_context`) and its associated busy state handlers.
- Maintain the instant, zero-cost static preview in `syncLLMContextPreview()`, which computes token bounds synchronously from configuration values:
  $$\text{Total Main Prompt} \approx \text{Memory Budget} + \text{Verbatim Budget} + \text{Base ST Overhead}$$

#### 5.3 Consolidate Defensive Dry-Run Guards
- Add a shared helper to `src/foundation/context.js`:
  ```javascript
  export function isDryRunEvent(eventData, dryRunArg) {
      return dryRunArg === true || eventData?.dryRun === true;
  }
  ```
- Standardize dry-run checks in:
  - `src/entry/events.js` (`onGenerationStarted`, `onGenerateAfterData`, `onChatCompletionPromptReady`)
  - `src/core/world-info-bake.js` (`injectPendingWorldInfoBake`)

---

## 5. Verification & Quality Gates

| Check | Command | Target Criteria |
| :--- | :--- | :--- |
| **Lint & Boundaries** | `npm run lint` | 0 errors, 0 warnings across all boundary rules (`foundation` $\to$ `core` $\to$ `features` $\to$ `entry`). |
| **Formatting** | `npm run format:check` | All files match Prettier configuration without manual formatting. |
| **Unused Code** | `npx knip` | 0 unused exports, files, or dangling dependencies. |
| **Duplication** | `npx jscpd src` | Duplication score remains strictly below the 5% threshold. |
| **Type Checking** | `npx tsc --noEmit` | Clean type-check against updated `types/globals.d.ts` and JSDoc annotations. |
| **Unit Tests** | `npm test` | All unit tests pass across parsers, planners, serializers, and budget models. |