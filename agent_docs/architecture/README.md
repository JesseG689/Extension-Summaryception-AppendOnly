# Architecture & State Ownership

## Runtime Composition
- Unbundled, browser-native extension loaded by SillyTavern (`manifest.json` -> `index.js`, `style.css`).
- Renders `settings.html`, binds SillyTavern lifecycle events, and initializes extension features.

## Dependency Policy
Strict one-way hierarchy enforced (`eslint.config.js`):
`foundation -> core -> features -> entry`

1. `src/foundation/`: Base constants, settings defaults, ST context facade, logger, retry primitives.
2. `src/core/`: Summarization engines, prompt assembly, token planning, ghosting, connections.
3. `src/features/`: Workflows over core (injection, maintenance, snippet management).
4. `src/entry/`: DOM bindings, settings UI, commands, ST event listeners.

*Rule*: Lower layers never import higher layers. When a lower layer needs a higher-layer value (e.g. `STATE_KEY_CEILING`), pass it as an optional parameter at the call site.

## SillyTavern Facade
- All runtime calls to SillyTavern globals pass through `src/foundation/context.js`.
- Missing optional ST APIs return `null`, `false`, or safe fallbacks. Update `tests/setup.js` whenever facade exports change.

## State Ownership
- **Per-Chat Metadata**: `chatMetadata[MODULE_NAME]`, accessed via `getChatStore()`.
- **Global Settings**: `extensionSettings[MODULE_NAME]`, accessed via `getSettings()`.
- **Effective Settings**: `getEffectiveSettings()` applies Easy, Advanced, or Off operating modes.
- **Mutations**: Save state via `saveChatStore()`. Any snippet/layer edit must call `bumpSummaryStoreMutationEpoch(store)`.