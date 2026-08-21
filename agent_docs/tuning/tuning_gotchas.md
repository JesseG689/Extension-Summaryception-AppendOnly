# Tuning Gotchas

- Do not optimize raw cost alone. Smaller context can reduce roleplay quality.
- Prefix Cache keeps a larger recent range and queues older chat for atomic flushes.
- Append Only keeps recent chat, queues older chat, and may add baked lore to the main request.
- Automatic summarization waits until the configured Recent + Queued raw-chat threshold is full.
- Memory below steady-state use silently truncates injected memory.
- Recall depends on prompt quality, model behavior, and chat depth.
- Cache savings estimates assume the provider caches the full frozen prefix.
