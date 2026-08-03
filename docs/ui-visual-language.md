# Summaryception UI visual language

Reference for restyling Summaryception or building a sibling SillyTavern plugin. Copy the interaction grammar and density. Do not copy the product name, exact layout, labels, or accent color.

## Goals

- The first view shows enabled mode, current activity, and anything needing attention.
- Compact, not cramped. Routine tabs fit near one settings-panel viewport.
- Read as a calm technical console: cards, rails, meters, terse labels. Never a wall of diagnostics.
- Inherit the host theme. Add one restrained product accent.
- Navigation stays usable while content scrolls.

## Structure

Order: host drawer header, compact mode control, one-line live status strip, sticky tab strip, active panel.

Use three to five tabs, ordered routine to specialist. Status, then stored data, then settings, then prompts, then diagnostics. Rename or omit by domain. Never put every control on one long page.

## Navigation

- Status opens on every reload and new session. Never restore the previous tab.
- A tab click changes the panel only. Inactive panels hide.
- The active tab uses a subtle filled surface and border, not a loud solid fill.
- The tab strip sticks to the top with a solid theme-derived background above content in stacking order. A transparent sticky bar lets scrolling labels show through and is wrong.
- Header, mode cards, and status may scroll away. Tabs stay docked.
- Keep list and tab roles, selected state, visible keyboard focus, and real text labels.

## Density

- Status shows overview, primary visualization, and operations together or with little scroll.
- Large specialist tabs use compact sections with collapsible expert groups.
- Use responsive two-column grids that drop to one column when narrow.
- Target roughly 5 to 8 pixels of primary spacing. Avoid large headings, hero space, wide prose, and excess padding.
- Give a label one short muted explanation. Move longer education into a help tooltip.
- Put a compact editable value chip beside every slider.
- Keep surfaces shallow: drawer background, faint bordered card, stronger nested surface, theme field, opaque sticky navigation. Avoid heavy shadows.

## Type and components

- Inherit body font and color. The plugin root sits near 0.9em.
- Small bold section titles pair with an accent icon.
- Labels carry the meaning; icons reinforce. An icon-only action still needs a tooltip and accessible label.
- Secondary text stays smaller and muted. Numeric and status values take stronger contrast.
- Prefer plain operational tab names.

Signature patterns:

- Mode cards: semantic icon, short title and description, native radio, accent border when selected. A row on desktop, stacked when narrow.
- Status strip: terse live facts separated by muted dots, quiet styling, wrapping allowed.
- Metrics: small two or three column cards showing only important values.
- Process rail: linked blocks for a pipeline or allocation, wrapping as coherent rows.
- Capacity bar: total beside the title, major label inside when space allows, compact legend, gray unused space. Never rely on color alone.
- Operations: common actions in a responsive row at the bottom of Status. Danger styling only for destructive or interrupting actions.

## Responsive

- Near 520 pixels, collapse grids and mode cards. Tabs may stack icon over label.
- Buttons may wrap or share width. Keep tab targets near 30 pixels.
- Never introduce horizontal page scroll. Rails, legends, and long values wrap or truncate safely.
- Test sticky tabs inside the real host drawer scroll container, not in isolation.

## Theme variables

Derive from host theme variables with a local fallback, so the plugin follows user themes:

```css
--plugin-border: var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.16));
--plugin-surface: rgba(255, 255, 255, 0.045);
--plugin-surface-strong: rgba(255, 255, 255, 0.075);
--plugin-field: var(--SmartThemeBlurTintColor, rgba(18, 18, 24, 0.86));
--plugin-accent: var(--SmartThemeQuoteColor, #66b2ff);
--plugin-danger: #ff6b6b;
--plugin-warning: #f0b84a;
--plugin-radius: 8px;
```

The accent decorates icons, focus rings, active borders, and small data marks. Never flood panels with it.

## Reject

- A restored last tab, scrolling-away tabs, or a transparent sticky bar.
- One huge settings page, oversized padding, or permanent help paragraphs.
- A hard-coded page theme, accent-filled panels, or unexplained icon-only navigation.
- Essential status or actions hidden inside diagnostics.
- Horizontal scrolling, clipped names, or missing focus, disabled, warning, and danger states.
