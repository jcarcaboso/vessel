# Dark design studies

The owner locked the side-by-side desktop layout before this visual-design round. The ten variants share one application, one data model, the same grid and the same responsive behavior.

September 30, 2026: Graphite was selected as the default, and configurable themes were accepted as a future capability. The approved geometry and entry-editing refinements are recorded in [the baseline](approved-baseline.md). The preview images below remain historical design-study screenshots, not the final geometry.

Comparison page: http://10.1.0.219:5173/designs.html

| Variant | Direction | Components |
| --- | --- | --- |
| Graphite | Neutral charcoal and cool silver | Solid primary action, recessed fields, underline tabs, 5px buttons |
| Carbon | Near-black and neutral white | Outline primary action, hairline fields, outlined tabs, 3px buttons |
| Midnight | Ink blue and muted cool blue | Solid blue primary action, recessed fields, filled tabs, 6px buttons |
| Slate | Steel gray and pale blue | Tonal primary action, framed fields, filled tabs, 4px buttons |
| Forest | Green-black and pale sage | Solid sage action, soft fields, underline tabs, 8px buttons |
| Petrol | Blue-green and muted cyan | Outline action, underlined fields and tabs, 4px buttons |
| Olive | Warm charcoal and soft chartreuse | Solid action, soft fields, filled tabs, 4px buttons |
| Espresso | Brown-black and warm copper | Outline action, underlined fields and tabs, 5px buttons |
| Aubergine | Muted plum-charcoal and lavender | Tonal action, framed fields, filled tabs, 7px buttons |
| Stone | Warm neutral gray and ivory | Paper-like solid action, hairline fields, outlined tabs, 3px buttons |

Direct routes are `/?theme=graphite`, `/?theme=carbon`, `/?theme=midnight`, `/?theme=slate`, `/?theme=forest`, `/?theme=petrol`, `/?theme=olive`, `/?theme=espresso`, `/?theme=aubergine`, and `/?theme=stone`.

`prototype/themes.mjs` owns palettes, component choices and the configurable `defaultTheme`. `prototype/themes.css` applies them over the existing layout; `prototype/baseline.css` owns the approved bounded workspace geometry. The Design dropdown changes CSS and chart colors in place, retains unsaved play data, and updates the URL. Explicit URLs can select another theme, but opening the default route always starts with Graphite rather than a previous study preference.

The comparison cards use real browser previews of the same synthetic play, with $2,500 margin and 6× leverage. JPEGs are local assets under `prototype/assets/previews/`. They are illustrative screenshots, not another source of account data.

## Controls settled before comparison

- Read-only available budget with pencil editing, explicit save/cancel, and an optional absent value.
- A Manual journal fixture with no account balance. Entered-position calculations still work; unavailable ratios stay absent.
- Chart dropdown containing Aggregate and every entry. Plotted labels support click and keyboard selection. The editor, plot and legend share focus. Aggregate remains an overview when an entry is focused.
- Leverage in the existing summary introduction, without adding a new summary row.
- The old layout switch removed. Older saved `below` preferences normalize to the locked side-by-side layout.

## Contrast and verification

The design target is at least 4.5:1 for normal text, including secondary labels and primary button text. See the W3C [contrast minimum explanation](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

`themes.test.mjs` checks the defined foreground/background pairs for every palette and the chart entry-tag labels. Browser checks separately inspect computed foreground and background colors, because a valid palette does not prevent an old, more-specific CSS rule from leaving a field white.

The browser audit sampled 834 visible text/control pairs per variant across the initial workspace, expanded assistant with budget editing and review, strategy, and evidence states. Every sampled pair passed 4.5:1. The comparison page and populated evidence state were also checked. These checks are not a full accessibility audit and do not establish contrast for every possible graphic, antialiased pixel or interaction.

Background transitions are disabled on buttons during these studies. Instant text-color changes against a background transitioning from another palette can otherwise pass through low-contrast intermediate states.

Browser geometry checks compared the heading, account context, capital context, workspace, chart, position editor, journal and summary. Their bounds matched across all ten variants. Mobile layouts and the expanded chart were checked at 390px and 320px. Existing keyboard focus, budget controls, missing-balance calculations, draft persistence and capture-note exports were exercised.

Graphite is approved as the starting palette. The other variants remain available as references for the future theme feature; no separate applications or production stack were created.
