# Cost and Budget Tuning

A grid-search script models cost per turn against recall and memory quality. Run it to regenerate numbers; do not trust figures copied into documents.

## Durable Conclusions

- Cache-friendly mode is already at its optimum. It sits at the minimum allowed memory budget and a forced verbatim window, so there is nothing to tune.
- Cache-friendly mode cannot reach the highest recall band, because the forced verbatim window pushes total context past it. This is a designed tradeoff, not a defect.
- Judging by raw cost alone always favors a smaller verbatim window. That rewards truncating context and degrades roleplay quality. Do not optimize on raw cost.
- Cost per quality token favors a larger verbatim window, because verbatim text carries full information weight while summarized memory carries less.
- The default verbatim window is the largest setting that still holds the highest recall band. It is a deliberate quality ceiling, not an arbitrary number.

## Model Caveats

- Recall degrades smoothly with context size. Treat any hard "good below N tokens" threshold as false.
- Information retention per summarization layer is an estimate calibrated from practice logs, not a measurement. Actual retention depends on prompt quality and model.
- The memory layer mix shifts over a chat. Early chats are almost all Layer 0; deep layers grow only after many promotions.
- Cache modeling assumes the whole frozen prefix is cached. Real providers have minimum chunk sizes and partial cache breaks, so predicted savings are optimistic.
- Tokens per turn is derived, not measured. A lower real density means more visible turns than reported.

## Coupled Constraints

- Cache-friendly mode forces the verbatim budget, so verbatim is not independently tunable there.
- The protected tail derives from the verbatim budget as a rounded fraction, clamped to a floor and ceiling. Changing verbatim moves the tail.
- Setting the memory budget below observed steady-state memory silently truncates memory. Keep the floor.
