# Testing

## Scope

- Cover core and foundation modules: parsers, engines, compaction, prompt logic, connections.
- Do not test DOM rendering, jQuery bindings, or multi-step browser scenarios.

## Assertions

- Assert outputs, state changes, and functional contracts.
- Never assert private constants or exact prompt prose. Both change often and the test adds no value.
- For prompt and token work, assert tag structure and dynamic block placement instead of text.

## Mechanics

- Global context and logging mocks live in the shared setup file.
- Build fixtures from the shared helpers module. Never hand-roll a runtime stub in a single test file.
- Changing the SillyTavern facade exports requires updating the shared setup.
