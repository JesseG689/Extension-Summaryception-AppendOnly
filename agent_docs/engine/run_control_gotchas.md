# Run Control

## Single Automatic Gate

- One engine function is the only entry point for automatic work. Every automatic trigger routes through the queue into that gate.
- Automatic triggers include turn checks, requeue callbacks, generation-ended events, the enable and mode toggles, and post-batch continuation.
- Add run-control guards inside the gate, never in a caller. A guard in a caller is bypassed by the other triggers.

## Pause Latch

- Stop latches a persistent paused flag. The gate then reports idle so the queue settles instead of spinning.
- Automatic work does not resume by itself while the latch is set. Resume clears the latch and kicks a single cycle.
- The paused flag is persisted with settings, so it survives a reload.

## Manual Runs

- Manual runs deliberately ignore both the paused latch and the enabled flag at engine level, so a one-shot order works while paused.
- UI handlers still gate manual actions on the enabled flag and warn the user. Keep the check in the handler, not the engine.

## Prompt Safety

- Automatic work must not mutate the prompt during an active generation.
- A stale prompt freeze is recovered at the start of an automatic cycle.
