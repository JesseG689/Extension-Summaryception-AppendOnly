# Append-Only Cache Gotchas

## Cache Contract

- The target cache matches exact message-list prefixes.
- A request extends the cached prefix only when its first added message has assistant role.
- Place each baked narrator message after the previous assistant reply and before the current user message.
- Do not place a baked narrator message before the previous assistant reply.
- Do not bake when the current user message has no preceding assistant reply.
- Keep the visible tail from the previous assistant reply through the baked narrator and current user message.

## Bake Contract

- Append-Only mode targets providers that discount stable cached input.
- Dynamic World Info must use the dedicated bake outlet.
- Constant World Info stays in its normal stable prompt position.
- Apply host World Info processing before storing each baked entry.
- Wrap each baked entry as a complete World Info block.
- Track each entry by lorebook identity and entry identity.
- A visible marker suppresses rebaking of the same entry.
- A hidden marker permits rebaking after the related history leaves the prompt.
- Store one compact narrator block for every normal user turn.
- Store resolved macro output once before sending or persisting it.
- Keep baked lore as background reference that cannot change the established scene.
- Use the host compact narrator presentation for baked lore.
- Exclude baked narrator messages from summarizer accounting.
- Baked narrator messages remain visible in the chat interface.

## Limits And Modes

- Select entries by priority and never truncate an entry or its tags.
- Enforce entry count, bake token, and remaining provider capacity limits.
- Measure the complete final payload when checking provider capacity.
- Skip baking when final token measurement is unavailable.
- Keep summary memory stable between flushes in Append-Only mode.
- Update summary memory at flush completion because its text changes the prefix.
- Keep time and date macros stable when using Append-Only mode.
- Prefix Cache uses a larger stable live window for providers with native prefix caching.
- Kimi reasoning replacement must rewrite final request history only. Do not mutate saved chat reasoning.
- Replace only assistant messages that already contain saved reasoning. Do not add a partial assistant tail.
- Balanced mode uses the rolling verbatim window without cache-specific baking.

## Migration And Cleanup

- Migration moves only dynamic lore entries into the dedicated bake outlet.
- Migration records each entry's original placement for exact restoration.
- Cleanup restores migrated entries and removes baked narrator messages through host deletion.
- Existing history cannot be retroactively baked.
- Flushes hide baked lore with the messages that contain it.
- Do not preserve baked lore through a summarization flush.
- Summary planning must not remove chat records.
- Remove non-conversation records only after an automatic drain, Force Summarize, or Slop Breaker is ready.

## Boundaries

- Depth-positioned World Info is unsupported in Append-Only mode.
- Group chats are unsupported in Append-Only mode.
- Bake only during normal generations.
- Retry, continue, quick reply, and dry-run paths must not create new baked content.
- The host World Info scan remains the source of activation data.
- Keep the flush boundary before the baked narrator and current user tail.
