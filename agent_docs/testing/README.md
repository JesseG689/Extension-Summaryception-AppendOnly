# Testing

- Framework and discovery in `vitest.config.js`; global setup in `tests/setup.js`.
- Use `tests/test-helpers.js` fixtures instead of inline SillyTavern, toastr, browser-runtime, or jQuery stubs.
- `src/foundation/context.js` and `src/foundation/logger.js` are globally mocked. Add every new context-facade export to `tests/setup.js` in same change.
- Override foundation mocks through `globalThis.summaryceptionFoundationMocks`. Use explicit `vi.unmock()` when testing real foundation modules.
- Test each `src/core/connection-*.js` source independently.
- Context tests must cover missing/undefined optional SillyTavern APIs and match defensive facade behavior.
- Run focused Vitest files while iterating; run `npm test` before handing off behavior changes.
- Never run ESLint or Prettier manually; Husky owns both.
- Prompt shape: durable durability/date-format/language rules live once in the static `DEFAULT_*` templates (`tests/constants.test.js` asserts them there), not in the runtime appenders. Tests that pass a shorthand custom base prompt (e.g. `'CTX {{context_str}} STORY {{story_txt}}'`) must only assert the appender's dynamic output (`<summaryception_source_budget>`/source-range lines, `<summaryception_promotion_constraints>` `at most N sentences` size lines, repair-feedback tags) — never assert a durable rule against the appended result of a custom-prompt fixture.
