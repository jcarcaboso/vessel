# Vessel

Read `docs/project-brief.md` and `CONTEXT.md` before changing product terminology or scope.

The current phase is visual discovery. The owner initially approved a static image, then requested a browser prototype served on the LAN. The disposable implementation lives in `prototype/`; see `docs/prototype.md` for scope and operation. Do not treat sample interactions as production features or choose a production stack without discussion. Play is provisional terminology.

The owner has now locked the side-by-side desktop layout. Preserve the positions of the chart, position editor, journal, capital context and summary while exploring visual design. The responsive stack is shared by all variants. Ten dark skins live in `prototype/themes.mjs` and `prototype/themes.css`, with a comparison page at `/designs.html`. Do not create separate app implementations or move sections merely to differentiate themes. Check both palette contrast and rendered controls after changing styles.

September 30, 2026: the owner approved Graphite as the default and configurable themes as a future product capability. The final baseline enlarges the journal, bounds the scrolling entry sidebar and adds an expanded entry editor. Read `docs/design/approved-baseline.md` before revisiting those decisions. Backend and frontend stack selection is the next phase, not implied by this prototype. The browser smoke checks are in `prototype/tests/browser-smoke.mjs`.

## Project tracking

- Repository: https://github.com/jcarcaboso/vessel
- Plane origin: https://kanban.testing.alpetxino.com
- Plane workspace: working-projects
- Plane project ID: `5eb5e953-f5ab-45c4-8b44-57c19512520d`
- Plane identifier: `VESSEL`
- Plane project: https://kanban.testing.alpetxino.com/working-projects/projects/5eb5e953-f5ab-45c4-8b44-57c19512520d/issues
- Outline origin: https://outline.testing.alpetxino.com
- Outline collection ID: `e8abc489-516e-44ac-8bf7-73c0d6a3f5be`
- Outline document ID: `0301d392-9dde-417c-93f9-72cf72f35325`
- Outline document: https://outline.testing.alpetxino.com/doc/vessel-edURkJD0Hp

Use the manage-project skill when starting or completing tracked work. Read the linked card and context first. Update Plane with verified progress or blockers and Outline when useful knowledge changes. Report failed remote updates explicitly.

The existing Trading Diary project points to a different GitLab repository. Do not carry its architecture, requirements, or task states into Vessel.
