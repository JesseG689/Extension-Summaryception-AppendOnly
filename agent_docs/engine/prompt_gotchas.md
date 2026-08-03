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
