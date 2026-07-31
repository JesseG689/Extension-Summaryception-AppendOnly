# Source Router

- **Architecture & Layering**: `agent_docs/architecture/README.md`
- **Engine, Prompts, Connections & State**: `agent_docs/engine/README.md`
- **UI, DOM & Workflows**: `agent_docs/ui/README.md`

## Rules
- Enforce one-way imports (`foundation -> core -> features -> entry`). Pass parameters at call sites instead of importing upward.
- Runtime `SillyTavern` global is accessed ONLY via `src/foundation/context.js`.
- Bump mutation epoch (`bumpSummaryStoreMutationEpoch`) on any snippet or layer edit.
