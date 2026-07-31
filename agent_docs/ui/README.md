# UI, DOM & Workflows

## DOM & Data Binding Rules
- Use jQuery `$()` for settings DOM queries, delegated events, and rendering. Native DOM creation limited to ephemeral inputs/downloads.
- Settings Binding (`ui-bind.js`):
  - `data-sc-setting`: Standard form fields.
  - `data-sc-slider-setting` & `data-sc-partner-input`: Range slider and partner value chip pairs.
- Sliders persist on `input`; text/numeric chips persist on `change` or blur.

## Navigation & Appearance
- Mode selection (Off / Easy / Advanced) sets `uiMode`, which gates runtime enablement. `configMode` (Easy/Advanced) is decoupled so the chosen complexity panel stays visible and editable even when the extension is Off. `syncEnabledContent` renders the off banner alongside the `configMode` panel, never instead of it.
- Default settings tab on startup is always `Status`.
- Inherit SillyTavern CSS variables; keep styling restrained and responsive (~520px collapse threshold).

## Workflow Boundaries
- Feature modules return structured outcome objects; entry modules format user-facing toasts/notices and trigger UI refreshes.
- Context budget preview, snippet browser, and status bars update via `updateUI()`.

## Modular STATE Categories
- Toggling state categories requires two-way wiring: write handler in `ui-events.js` (`bindToggleHandlers`) and read-back sync in `ui.js` (`updateUI`).
