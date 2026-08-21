# Tuning Gotchas

- Do not optimize raw cost alone. Smaller context can reduce roleplay quality.
- Prefix Cache keeps a larger recent A range and queues older B chat for atomic flushes.
- Append Only keeps A, queues B, and may add baked lore as C to the main request.
- Automatic summarization waits until the configured A+B raw-chat threshold is full.
- Memory below steady-state use silently truncates injected memory.
- Recall depends on prompt quality, model behavior, and chat depth.
- Cache savings estimates assume the provider caches the full frozen prefix.
