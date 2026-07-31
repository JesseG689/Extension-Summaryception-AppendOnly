# Test Router

- **Testing Guidelines & Mock Rules**: `agent_docs/testing/README.md`

## Rules
- Run tests via `npm test`.
- Assert outputs, state mutations, and functional contracts. Never assert private constants or exact prompt prose.
- Use shared helpers from `tests/test-helpers.js` and global mocks in `tests/setup.js`.
- Do not test UI/DOM bindings or build end-to-end multi-step flows.
