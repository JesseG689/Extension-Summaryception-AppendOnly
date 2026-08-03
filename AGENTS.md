# Summaryception

Browser-only SillyTavern extension for recursive layered summarization. Summarized messages are hidden from model context with native hide commands, but stay visible in the chat UI.

## Work Rules

- Husky owns lint, format, repomix output, and version bumps. Never run formatters manually.
- Preserve unrelated changes. Never commit, push, or sync without explicit authorization.

## Global Boundaries

- Imports flow one way: foundation, then core, then features, then entry. Never import upward.
- Reach the SillyTavern runtime global only through the foundation context facade.
- Read runtime behavior from effective settings. Use raw settings only for persistence and UI forms.
- Any summary layer or snippet mutation must bump the store mutation epoch.

## Commands

- `npm test` runs the suite.

## Documentation Map

- Layering, facade, state ownership: `agent_docs/architecture/architecture.md`
- Summarizer, memory, prompts, connections: `agent_docs/engine/engine.md`
- UI, DOM, workflows: `agent_docs/ui/ui.md`
- Testing: `agent_docs/testing/testing.md`
- Cost and budget tuning: `agent_docs/tuning/tuning.md`
- Routers: `src/AGENTS.md`, `tests/AGENTS.md`
