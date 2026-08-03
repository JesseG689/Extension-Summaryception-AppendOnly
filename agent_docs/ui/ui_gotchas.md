# UI and Workflow Gotchas

## DOM and Binding

- Settings DOM uses jQuery for queries, delegated events, and rendering. Native DOM creation is limited to ephemeral inputs and downloads.
- Data attributes declare bindings: one for standard fields, and a slider and partner-input pair for range controls with a value chip.
- Sliders persist on input. Text and numeric chips persist on change or blur.

## Mode Gating

- The operating mode gates whether the extension runs. The complexity mode selects which panel renders.
- The two are deliberately decoupled, so the chosen panel stays visible and editable while the extension is off.
- When off, the off banner renders alongside the complexity panel, never instead of it.
- The Status tab opens on every startup. Never restore the previously active tab.

## State Categories

- A state category toggle needs two-way wiring: a write handler in the events module and a read-back sync in the render path. One side alone leaves the toggle visually stuck.

## Workflow Boundaries

- Feature modules return structured outcome objects. Entry modules format the toasts and notices and trigger refreshes.
- Keep user-facing text out of feature modules.

## Styling

- Inherit host CSS variables. Keep styling restrained and responsive, collapsing near 520 pixels.
