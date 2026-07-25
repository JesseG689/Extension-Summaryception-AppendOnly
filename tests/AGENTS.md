# Test Router

Read [testing guidelines](../agent_docs/testing/README.md) before writing or modifying tests.

## Key Rules for AI Agents

1. **Refactor-Resilient**: Test contracts, outputs, and state transformations. Never assert exact internal constants or implementation details (e.g. no `expect(LIMIT).toBe(20)`).
2. **Pragmatic (~70–80% Coverage)**: Cover core engine logic, parsers, and connection adapters. Do NOT attempt 100% coverage or test every obscure edge case.
3. **Skip UI & Full E2E**: Do not test DOM/UI elements, jQuery bindings, or full end-to-end integration flows.
4. **Small & Reasonable**: Keep tests concise, readable, and focused on single behaviors.
5. **Reuse Shared Helpers**: Always use fixtures in `tests/test-helpers.js` and setup stubs in `tests/setup.js`. Do not build local runtime stubs.
