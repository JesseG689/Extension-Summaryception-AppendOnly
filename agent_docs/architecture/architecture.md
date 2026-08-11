# Architecture and State Ownership

## Layering

- Layers are foundation, core, features, entry. Imports flow one way only.
- The lint boundary plugin enforces the direction. It cannot catch intent, so do not design around it.
- A lower layer that needs a higher-layer value takes it as an optional call-site parameter. Never import upward to reach it.

## SillyTavern Facade

- All runtime calls to SillyTavern globals pass through the foundation context module.
- Missing optional host APIs return null, false, or a safe fallback. Callers must not assume the API exists.
- Changing facade exports also requires an update to the global test setup.
- Dynamic lore for append-only caching is stored as native narrator messages with stable markers.
- The bake path updates the API payload and chat storage in the same prompt-ready event.
- Baked lore is excluded from summarizer accounting but remains visible in the chat UI.
- Cap a bake against the complete final payload after reserving response tokens. Skip the bake when final token measurement is unavailable.
- Lore migration moves only dynamic entries and records their original placement. Cleanup restores placement and uses native chat deletion.
- Summary flushes end on an assistant message. Keep the following baked narrator and user message visible as one tail extension.

## State Ownership

- Per-chat summaries live in chat metadata. They survive with the chat, not with the extension.
- Global configuration lives in extension settings.
- Effective settings apply the Off, Easy, or Advanced operating mode over raw settings. Runtime code reads effective settings. Persistence and UI forms read raw settings.
- Any snippet or layer edit must bump the store mutation epoch, then save. Consumers cache on the epoch and will show stale data without the bump.
