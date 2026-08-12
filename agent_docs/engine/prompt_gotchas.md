# Prompt Assembly

## Section Order

- Prompts assemble in a fixed order: input, output schema, task rules, critical rules, execution trigger.
- The bare imperative trigger must be the final line of the prompt.
- Dynamic blocks, including the source budget and repair feedback, insert above the trigger. Never append them after it.

## Budget Hints

- Budget hints speak only in units a model can count, such as sentences and lines. Never express a hint in tokens or percentages.
- Sentence caps derive from the layer and the token target.

## Schema

- The state schema placeholder resolves at build time from the enabled state categories. Editing the category list changes the prompt.
- Token caps never appear in category definitions.

## Output Policy

- An ideograph output filter strips unwanted script from summaries.
- Configurable strip patterns run over model output before parsing.

## Prompt Diagnostics

- Prompt-ready dry runs can mark either the event payload or a separate argument. Ignore both forms before updating comparison state.
- Report one contiguous-prefix verdict per real request. Per-section logs obscure duplicate events and make cache failures difficult to identify.
- SillyTavern can omit the system flag on normal assistant messages. Treat only an explicit true value as a system message.
