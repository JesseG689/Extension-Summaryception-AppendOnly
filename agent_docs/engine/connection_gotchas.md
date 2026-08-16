# Connection Gotchas

- Separate routes handle new summaries, deeper merges, and retryable fallback.
- Adapters cover the active host API and saved connection profiles.
- Profile requests disable host preset and instruct injection.
- Retry with exponential backoff.
- Hard network errors skip remaining primary retries and start fallback.
- Configure timeouts independently for each route.
- Retry attempts use a shorter timeout than the first attempt.
