# Architecture and State Ownership

## Layering

- Layers are foundation, core, features, entry. Imports flow one way only.
- The lint boundary plugin enforces the direction. It cannot catch intent, so do not design around it.
- A lower layer that needs a higher-layer value takes it as an optional call-site parameter. Never import upward to reach it.

## SillyTavern Facade

- All runtime calls to SillyTavern globals pass through the foundation context module.
- Required host APIs target the latest stable SillyTavern release. Optional integrations can return a safe fallback.
- Changing facade exports also requires an update to the global test setup.

## State Ownership

- Per-chat summaries live in chat metadata. They survive with the chat, not with the extension.
- Global configuration lives in extension settings.
- Effective settings apply the Off, Easy, or Advanced operating mode over raw settings. Runtime code reads effective settings. Persistence and UI forms read raw settings.
- Any snippet or layer edit must bump the store mutation epoch, then save. Consumers cache on the epoch and will show stale data without the bump.
