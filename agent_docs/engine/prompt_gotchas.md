# Prompt Assembly

## Section Order

- Prompts assemble in a fixed order: input, output schema, task rules, critical rules, execution trigger.
- The bare imperative trigger must be the final line of the prompt.
- Dynamic blocks, including the source budget and repair feedback, insert above the trigger. Never append them after it.

## Budget Hints

- Budget hints speak only in units a model can count, such as sentences and lines. Never express a hint in tokens or percentages.
- Sentence caps derive from the layer and the token target.

## Schema

- The state schema placeholder resolves at build time from the enabled state categories. Editing the category list changes the prompt.
- Token caps never appear in category definitions.

## Output Policy

- An ideograph output filter strips unwanted script from summaries.
- Configurable strip patterns run over model output before parsing.

## Prompt Diagnostics

- Prompt-ready dry runs can mark either the event payload or a separate argument. Ignore both forms before updating comparison state.
- Report one contiguous-prefix verdict per real request. Per-section logs obscure duplicate events and make cache failures difficult to identify.
- A broken-prefix verdict includes the complete first changed block in a collapsed, copyable JSON payload.
- SillyTavern can omit the system flag on normal assistant messages. Treat only an explicit true value as a system message.

## World Info Bakes

- Track baked entries by lorebook and UID. A UID alone is not globally unique.
- Suppress an entry only while its bake marker is visible. Hidden markers permit a later bake.
- Apply World Info regex processing before wrapping each entry.
- Add only complete entry blocks that fit the entry, bake-token, and provider limits.
- Always render baked lore with the host compact narrator style. Do not expose a presentation setting.
- Frame baked lore as background reference. Its presence must not change the established scene, location, character, or scenario.

## Append-Only Regeneration

- In Append Only mode, bake new World Info only during normal generations. Other generation types must preserve the prompt prefix.
