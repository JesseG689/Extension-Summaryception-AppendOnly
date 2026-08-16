# Tuning Gotchas

- Do not optimize raw cost alone. Smaller context can reduce roleplay quality.
- Cache-friendly mode trades recall for stable provider prefixes.
- Cache-friendly mode couples the verbatim window to its memory budget.
- The protected tail changes when the verbatim budget changes.
- Memory below steady-state use silently truncates injected memory.
- Recall depends on prompt quality, model behavior, and chat depth.
- Cache savings estimates assume the provider caches the full frozen prefix.
