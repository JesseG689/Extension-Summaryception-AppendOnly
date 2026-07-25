# Testing Guidelines

## Core Philosophy

- **Refactor Resilience**: Test high-level behavior, inputs/outputs, and state transformations. **Never write change-detector tests or assert hardcoded implementation details/constants** (e.g., do NOT write tests checking if `const FOO = 20`).
- **Pragmatic Scope (~70–80% Coverage)**: Aim for solid coverage of core business logic, engine execution, summarization pipelines, state compaction, and connection handling. Aiming for 100% or obsessing over every microscopic edge case is discouraged.
- **No UI Testing**: Do not test UI/DOM rendering, jQuery bindings, CSS classes, HTML structures, or dialogs. Focus exclusively on headless logic in `src/core/` and `src/foundation/`.
- **No Full Start-to-Finish E2E**: Unit tests and shallow module integration tests are preferred. Do not build massive end-to-end multi-step integration flows.
- **Keep Tests Small & Reasonable**: Write clean, concise, deterministic tests. Avoid sprawling test files or complex test setups.

## Execution & Technical Rules

- **Framework & Setup**: Configured via `vitest.config.js`; global mocks reside in `tests/setup.js`. Run tests with `npm test` (or focused runs via `npx vitest tests/<file>.test.js`).
- **Shared Test Helpers**: Always use `tests/test-helpers.js` (`makeMessage`, `makeSummaryStore`, `installSillyTavernStub`, etc.). Do NOT construct local, inline SillyTavern, toastr, or DOM stubs.
- **Foundation Mocks**: `src/foundation/context.js` and `src/foundation/logger.js` are globally mocked in setup. If you add a new export to `context.js`, update `tests/setup.js` in the same change.
- **Connection Testing**: Test connection adapters (`src/core/connection-*.js`) individually with lightweight transport mocks.
- **Prompt Testing**: Test dynamic tag structure and dynamic block insertion (e.g. `<summaryception_source_budget>`) rather than verifying static template prose verbatim.
- **Linting & Formatting**: Never run ESLint or Prettier manually; Husky git hooks manage formatting automatically.
