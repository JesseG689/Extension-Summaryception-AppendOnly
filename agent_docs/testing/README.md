# Testing Guidelines

## Philosophy
- **Refactor-Resilient**: Assert outputs, state changes, and functional contracts. Never assert private implementation constants or exact text templates.
- **Pragmatic Scope**: Focus on `src/core/` and `src/foundation/` (parsers, engines, compaction, prompt logic, connections).
- **No UI/E2E Tests**: Do not test DOM rendering, jQuery bindings, or multi-step browser scenarios.

## Mechanics & Mocks
- **Execution**: Run `npm test` (Vitest).
- **Setup**: Global context and logging mocks live in `tests/setup.js`.
- **Shared Helpers**: Use `tests/test-helpers.js` (`makeMessage`, `makeSummaryStore`, `installSillyTavernStub`, etc.). Never build ad-hoc runtime stubs in individual test files.
- **Prompt & Token Tests**: Verify tag structures and dynamic block placement rather than exact prose text.