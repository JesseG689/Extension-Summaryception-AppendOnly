# Testing Gotchas

- Assert outputs, state changes, and functional contracts.
- Do not assert private constants or exact prompt prose.
- For prompt and token work, assert structure and dynamic block placement.
- Shared setup owns host context and logging mocks.
- Shared helpers own runtime fixtures.
- The host returns cloned lorebook data on load. Tests must copy source fixtures so source-preservation checks stay valid.
- Update shared setup when host facade exports change.
