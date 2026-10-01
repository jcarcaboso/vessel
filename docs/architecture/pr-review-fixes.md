# First-part review safeguards

October 1, 2026. PR #1 received five blocking P2 findings and two non-blocking P3 improvements. This record describes the fixes and the contracts the next implementation must preserve. Review threads are resolved only after regression and integration checks pass.

## Exact totals and independent reads

Portfolio and overview values use the same integer-coefficient exact-sum helper as nominal stablecoin totals. The result is formatted directly as a decimal string, not converted back into a limited .NET decimal. This preserves accepted mixed-scale values, negative venue equity and sums larger than an individual decimal's capacity.

Account and portfolio resource lists/reads do not depend on computing Overview aggregates. Single-account snapshot reads apply the account ID in SQL before including positions or stablecoins, with the existing owner/enabled predicates.

## Venue source identity

A connected account's normalized owner, venue and public address identify one source record. Manual null-address accounts remain unrestricted, and another journal owner may monitor the same public address independently. Disabled records retain their identity; creating an alias does not duplicate balances and fills.

Application conflict checks and a partial PostgreSQL unique index defend concurrent creation. Before normalizing/applying the index, the migration checks existing normalized duplicates and stops safely. It does not merge/delete facts or Play references silently. Operators must resolve genuinely duplicated sources deliberately.

## Settings revisions

`AccountDto.settingsRevision` is independent of market observation time. Full account PUT requires `expectedRevision` along with name, nullable portfolio and enabled state. Compare the expected revision under the account row lock and reject stale saves with safe 409.

Settings changes and portfolio-deletion unlinking advance the revision. The browser form retains its original revision. A conflict disables Save and offers explicit reload of current name/group/enabled/revision. Stale changes are not replayed automatically.

Missing legacy revision is accepted only for a temporary read-side rollout; it is not sufficient to save a management form. This prevents a previously opened rename form from silently re-enabling or moving an account.

## Snapshot freshness

Refresh serialization alone does not establish source freshness. Compare each source observation against retained state while holding the account lock:

- Perpetual snapshot time controls replacement of its balances/positions.
- Stablecoin wallet time is independent and controls its replacement separately.
- Older or equal observations retain the existing state. Newer observations replace it.
- Fill ingestion remains separately deduplicated, even when the snapshot is old.
- Account sync observation metadata must never regress.

Equal timestamp retention is deliberate, not a source-correction policy. Corrections and long outages still require their later specification.

## Frontend detail retry

The shell passes its Reload generation to AccountDetail. A changed generation starts a new snapshot/fill attempt even when Overview metadata is identical. Loading/error visibility follows that attempt, retains previous observations while pending, and keeps the existing abort/active guards.

## Safe diagnostics

Unexpected failures emit a structured server event with a locally generated trace ID, matched route pattern, exception type, status and bounded method-only stack information. Never log arbitrary exception messages/objects, file paths, Authorization, body/query values, addresses, raw provider payloads or connection strings.

Generic Problem Details returns the trace ID and matching correlation header. Expected validation/domain/bad-request/cancellation responses do not become noisy error events. Known transient dependency failures remain generic 503; internal bugs are generic 500 rather than pretending every failure is a retryable outage.

## Verification and scope

Regression coverage must include the review's exact/overflow examples, duplicate/concurrent source creation, stale disable/move forms, `10:00 → 09:00 → 11:00` source state, equal timestamps, independent wallet chronology, account-scoped reads, detail retry/content refresh and secret-bearing exceptions with safe capture logs.

These safeguards are part of the core/management checkpoint, not Play implementation, automatic fill attribution, full-history import or production security approval. The separate stablecoin correction remains documented in [wallet availability](stablecoin-wallet.md).
