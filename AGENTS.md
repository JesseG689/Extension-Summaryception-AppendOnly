# Summaryception

Browser-only SillyTavern extension for recursive layered summarization. Uses native `/hide` & `/unhide` commands to exclude summarized messages from LLM context while keeping them visible in the chat UI.

## Work Rules
- **Tooling**: Husky manages ESLint, Prettier, repomix outputs, and post-commit version bumps. Never run formatting manually.
- **Git**: Preserve unrelated changes. Do not commit, push, or sync without explicit authorization.

## Critical Boundaries
- **One-Way Imports**: `foundation -> core -> features -> entry`. Lower layers NEVER import higher layers.
- **SillyTavern Global**: Access runtime `SillyTavern` strictly via `src/foundation/context.js`.
- **Settings**: Use `getEffectiveSettings()` for runtime behavior; use raw `getSettings()` for persistence and UI forms.
- **Mutation Epoch**: Any summary-layer or snippet mutation MUST call `bumpSummaryStoreMutationEpoch(store)`.

## Documentation Map
- **Source Architecture**: `agent_docs/architecture/README.md`
- **Engine, Prompts & Connections**: `agent_docs/engine/README.md`
- **UI & Workflows**: `agent_docs/ui/README.md`
- **Testing Guidelines**: `agent_docs/testing/README.md`
- **Sub-Routers**: `src/AGENTS.md`, `tests/AGENTS.md`