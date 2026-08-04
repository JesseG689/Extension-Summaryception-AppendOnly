# Connections and Routing

## Routes

- Three routes exist: Layer 0 for new summaries, merge for deeper promotions, fallback for retryable failures after the primary route gives up.
- Adapters cover the host active API and host connection profiles.
- Profile requests must disable host preset and instruct injection. The host enables both by default and corrupts summarizer output.

## Retries and Failover

- Retries use exponential backoff.
- Hard network errors skip the remaining primary retries and go straight to fallback. Retrying a dead endpoint only delays recovery.
- Retry attempts run at 75 percent of the initial attempt timeout.
- Timeouts are configured in seconds, separately per route.
