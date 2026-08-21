# Run Control Gotchas

- One engine gate owns all automatic work.
- Route every automatic trigger through the queue and engine gate.
- Put automatic run guards in the gate.
- Stop persists a pause latch and lets the queue settle.
- Resume clears the latch and starts one cycle.
- Manual engine runs ignore the pause latch and enabled state.
- UI handlers still block manual actions when the extension is disabled.
- Manual run callbacks and the abort signal pass as an explicit argument. Never carry them on the task object.
- A manual run needs a numeric target boundary. Reject the run when the route plan omits it.
- Automatic work must not mutate the prompt during generation.
- Recover stale prompt freezes at the start of an automatic cycle.
