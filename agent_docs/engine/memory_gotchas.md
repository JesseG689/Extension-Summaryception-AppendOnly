# Memory, Compaction and Ghosting

## Layer Model

- Layer 0 summarizes turns that fall outside the verbatim window into a narrative section and a rolling state snapshot.
- State is a bounded rolling snapshot, not an accumulator. Only the newest state reaches the prompt.
- Deeper layers merge older snippets when a layer exceeds its snippet limit.
- A promotion reads the final snapshot in the promoted span. Earlier snapshots in that span are superseded.

## Snapshot Compaction

- The state snapshot targets 700 tokens and hard-caps at 1000.
- Compaction runs deterministically in process. It is not a model call and must stay that way.
- Compaction runs once per assembly. Never add a second pass; the trim is already applied.
- Per-category character budgets apply independently. The current date and time category is exempt and is carried verbatim.

## Output Size Bounds

- Each layer accepts output within a ratio band of the token target. Layer 0 and Layer 1 floor at 0.4 of target. Layer 2 and deeper floor at 0.3.
- Ceilings are 1.5 of target, except Layer 1 promotions at 1.75.
- These bands are acceptance bounds on generated output. They are distinct from the memory budget allocation ratios, which split the injection budget across layers. Do not conflate the two.
- Output outside the band triggers section-aware repair. Repair retries one failed section, not the whole summary.

## Dates

- The narrative section uses calendar dates only. No years, no ISO syntax, no clock lead-ins.
- The weekday token in state is unreliable as generated. Re-derive it from the ISO date in UTC on every read.

## Message Ownership

- Stable message identifiers own snippet provenance and ghosting. Resolve them to current chat indices only for planning and host commands.
- Ignore missing identifiers. Do not infer ownership from a former array position.
- Summarized turns are hidden through the host hide command and stay readable in the chat UI.
- Unhide only store-owned messages. Never disturb messages that the user hid.
- By default, ghosting also hides text-less messages between summarized turns. A setting keeps them visible when required.
- For baked World Info cleanup and flush boundaries, read `append_only_gotchas.md`.

## Injection

- Standard placements inject through a host extension prompt. Macro-only placement instead exposes the assembled memory as a macro for custom prompt layouts.
- A setting controls whether the current state block is prepended to injected memory.
