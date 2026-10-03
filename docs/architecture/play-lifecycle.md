# Play lifecycle

October 3, 2026. After PR #4 merged, the owner asked to save Plays, link the instrument on its venue and settle the Play lifecycle. The owner agreed to the model below and asked to build it directly in the repository, without Plane or Outline updates for now.

## Three independent tracks

A Play's lifecycle is split into three tracks rather than one combined status:

| Track | Driven by | Values |
|---|---|---|
| Status | The owner, and later linked venue facts | Draft, Planned, Paused, Open, Closed, Cancelled |
| Execution progress | Linked venue orders and fills, derived | e.g. "2 of 3 entries filled · 65% of planned quantity in · 30% out" |
| Review | The owner | none, reviewed, amended; every revision kept |

Partial entries and partial exits are progress within Open, not extra statuses. An entry can fill and reach its first target while another entry is still resting, so status values such as "partially in" would multiply. Waiting for a review is not a stage of the trade either. Reviews are their own record, available for Closed and Cancelled Plays ("why didn't I take it?").

## Status

```
Draft ──► Planned ◄──► Paused
  │          │            │
  ├──────────┴────────────┴──► Cancelled (reason)
  │          ▼
  │        Open ──► Closed
  └──► deleted (Drafts only)
```

- **Draft**: the idea. Freely editable, saved on the server, not yet committed. Only Drafts can be deleted; deleting one removes its evidence.
- **Planned**: committed to the plan, orders expected on the venue. Planning records plan revision 1. The account and instrument are fixed from here on.
- **Paused**: orders withdrawn while the idea stays valid. Only reachable before any fill. Resuming returns to Planned. A fill that arrives while paused still wins: the Play becomes Open and is flagged for review.
- **Open**: at least one linked entry fill.
- **Closed**: all linked entry quantity has exited and no linked entry order is still resting. A flat venue position is not enough, because concurrent Plays can share one account and instrument.
- **Cancelled**: never filled. Keeps a reason (invalidated, missed, changed mind, expired, mistake, other) and an optional note. Missed and abandoned ideas are review material.

Closed and Cancelled are final. A follow-up idea is a new Play rather than a reopened one. Imported history without a plan will enter as Open or Closed, marked retrospective, with no invented thesis.

## Plan revisions

Stops, targets and entries that have not been taken can always change, because conditions change. Each change after planning is a new **plan revision** with the reason the owner gives, so analysis can compare the original plan with what was done ("the stop moved twice").

- Draft edits are free and create no revision.
- Planning saves revision 1, reason "Planned".
- In Planned, Paused and Open, a plan change requires a reason and creates the next revision. Title, drawings and the review note do not create revisions.
- Revisions are append-only snapshots of the plan: direction, sizing, leverage, budget override, entries with stops and targets, thesis, invalidation, strategy and evidence notes.
- Once fills are linked, only entries without fills can change their entry price or share. That rule arrives with order linking.

## Venue link

Vessel stays read-only and never places orders. The workspace links to the instrument's trading page on the venue (Hyperliquid: `https://app.hyperliquid.xyz/trade/{contractId}`) so the owner can place the planned orders there. Manual instruments have no link.

## Order and fill linking

The owner's policy is **automatic where possible, manual only when it cannot be**:

- Vessel reads the account's open orders and fills for the Play's instrument and links them to entries and exits automatically when the match is unambiguous: same account, instrument and side; price equal to the planned level within the instrument's tick; size consistent with the planned quantity; and only one Planned, Paused or Open Play that could claim it.
- Ambiguous candidates, for example two concurrent Plays with the same level, are shown for the owner to confirm. They are never assigned silently.
- Linked order IDs drive the status: the first linked entry fill moves Planned to Open, and the last exit fill with no linked entry order still resting moves Open to Closed. Each automatic transition records its source facts.
- A price touching a level is an observation, never a fill.

## Monitoring and notifications

The later monitor watches linked order IDs and plan levels server-side. It drives the automatic transitions above and creates notifications when an entry, stop or target fills, or when a level is approached without a linked order. It changes who triggers the transitions, not the model.

## Delivery order

1. **Saved Plays** (this step): Draft, Planned, Paused and Cancelled with manual transitions, plan revisions with reasons, a history view, saved evidence and the venue link.
2. **Order and fill linking**: automatic matching with manual confirmation of ambiguous cases, Open and Closed with execution progress.
3. **Review**: a separate record with revisions and a "needs review" list.
4. **Monitoring and notifications**: server-side tracking that drives transitions and alerts.

## Saved Plays contract

Authenticated, owner-scoped routes under `/api`:

| Route | Purpose |
|---|---|
| `GET /plays` | Summaries, most recently updated first |
| `POST /plays` | Create a Draft |
| `GET /plays/{id}` | Full Play: head, plan, drawings, review note |
| `PUT /plays/{id}` | Save. Requires `expectedVersion`. A plan change after planning requires `revisionReason` |
| `POST /plays/{id}/status` | `{ expectedVersion, status, reason?, note? }` for plan, pause, resume and cancel |
| `GET /plays/{id}/history` | Plan revisions and status changes |
| `DELETE /plays/{id}` | Drafts only, with their evidence |

- The account must be the owner's and enabled to create or plan a Play. The instrument belongs to the account's venue; venue instruments use contract IDs, manual accounts use a manual label.
- Planning requires an instrument and at least one entry with a positive price.
- `version` increases on every write; a stale `expectedVersion` returns 409 so two tabs cannot overwrite each other.
- Number fields keep the exact text the owner entered. Draft values may be blank or incomplete.
- Drawings are stored per instrument as the chart's own JSON, bounded in size, and are not part of plan revisions.
- Evidence uses the existing evidence routes once the Play exists. The browser uploads draft images on the first save and synchronizes notes, markup and removals on later saves.

## Saved Plays state

October 3, 2026. Step 1 is implemented on branch `t3code/603adfcf`.

- Backend: `Play` (Domain) holds status, plan JSON, drawings, review, plan revision and version. `PlayPlanRevision` and `PlayStatusChange` are append-only, owner-scoped, `Restrict` foreign keys. `PlayDocuments` (Application) validates the plan (≤20 entries, ≤10 targets each, decimal-text numbers, whole leverage 1–100, unique item IDs, notes ≤20,000 characters) and bounds drawings (≤100 instruments, ≤200 drawings each, ≤1 MB). `PlayService` applies the transitions; `PlayStore` (Persistence) maps a concurrent EF write to 409. Routes are in `PlayEndpoints.cs`.
- Migration `SavedPlays` turns earlier `Active` heads into `Planned` with a blank plan, sets manual sources for manual venues and keeps closed heads closed. The API still does not migrate on start; run `pnpm db:migrate`.
- Cancel is also allowed from Draft in the API; the UI offers Delete for Drafts and Cancel for Planned and Paused.
- Frontend: Plays opens a list (In progress, Closed and cancelled, All) with New play. The shell keeps the open play and its unsaved edits while navigating; another play cannot be opened until they are saved or discarded. The editor reuses the approved workspace and adds Save, Plan it, Pause, Resume, Cancel play, Delete (drafts), History and the venue link. Planned plays fix the account and instrument. Closed and cancelled plays disable the plan and keep the review and evidence editable.
- Saving a planned plan change asks for a reason. Title, drawings, review and evidence changes save without one. History lists revisions with a readable diff by entry and target identity, and status changes with cancel reasons.
- Evidence: the first save uploads draft images through the existing evidence routes; later saves sync note and markup edits and removals. A failed image sync keeps the Play saved and retries on the next save. Capture context text and file names are not stored on the server, so reopened images get generated names.
- Draft item IDs now combine time and randomness instead of a per-page counter, because saved plans keep them across page loads.

Verification:

- `pnpm check` passes 573 backend tests (PostgreSQL tests run against a disposable test database, none skipped), 288 frontend tests, both builds, lint and the prototype tests.
- A headless Chromium 151 run against a real API and a scratch PostgreSQL database covered: save draft, the Hyperliquid catalogue and the link `https://app.hyperliquid.xyz/trade/HYPE`, Plan it, stop change with a revision reason, history diff ("Entry 1 stop: 37 → 38"), reload and reopen, cancel with reason, and evidence upload, note change, reload, removal and draft deletion. No console errors; no horizontal overflow at 1402, 1001 and 390 pixels.
- Not covered: Open and Closed (they need order linking), concurrent edits from two browsers beyond the version check, and very large drawing sets.
