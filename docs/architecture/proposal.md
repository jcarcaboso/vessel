# Stack and architecture proposal

Working architecture context, September 30, 2026. Confirmed MVP direction is recorded in the linked alignment document; the owner subsequently authorized [foundation scaffolding](scaffold-contract.md). See [implementation state](foundation-state.md) for the code that now exists. Remaining business workflows are proposals, and the approved disposable Graphite prototype remains unchanged.

October 1, 2026: [core account/portfolio and Hyperliquid state](core-workspace-state.md) supersedes the first scaffold's delivered/deferred list. The new main shell intentionally does not mount the Play editor. Later monitoring, matching, chart, media and notification workflows remain proposals.

The owner confirmed TypeScript, feature/module boundaries, self-hosted single-user token access, perpetuals-first across venues, multiple active plays, Hyperliquid-first integration, manual venues and the direction of monitored plays and in-page notifications. See [the MVP alignment record](mvp-alignment.md) for scope and remaining decisions. The foundation uses shadcn-derived controls, direct runtime bearer access and minimal EF/PostgreSQL account/play heads. Scheduler, broker, production session policy, final chart renderer and complete schema remain unimplemented.

The owner proposed React with Vite, ASP.NET Core 10 with PostgreSQL, clean module boundaries, extensible venue integrations, isolated persistence, local storage with a route to S3-compatible storage, and background processing with a possible message broker.

My recommendation is a feature-oriented React application and a modular backend deployed as one application initially. Keep business rules separate from persistence and external services. Start with durable background processing, but do not make a message broker, microservices, a generic engine framework, or database interchangeability prerequisites.

## Frontend

Proposed baseline: React, Vite and TypeScript. Use a few route-level pages composed from feature-owned components, hooks, draft models and API calls. Suggested feature areas are the play workspace, accounts and portfolios, strategies, and evidence. Shared code should contain genuinely shared controls, theme tokens and HTTP infrastructure, not another copy of every feature's business logic.

React's documentation lists Vite as a supported build-tool option for a from-scratch application and explains that routing, data fetching and other application concerns still need to be chosen. React now generally recommends frameworks, so this is a deliberate choice for Vessel's interactive authenticated workspace rather than a claim that Vite solves the whole application.[1]

Proposed frontend boundaries:

- Route pages compose features; they do not contain all editing, networking, chart and calculation logic.
- Keep unsaved play state distinct from API/server state. A venue refresh must not silently overwrite an unsaved thesis or position.
- Give the chart an adapter boundary so the selected library does not dictate the journal model.
- Preserve Graphite as the default and the token-based theme capability.
- Use an explicit API contract, with generated TypeScript types/client if useful. Specify decimal encoding and nullability before generation.
- Treat browser calculations as responsive previews. The backend validates authoritative calculations, with shared test cases to detect disagreement.

The tradeoff is choosing more supporting pieces ourselves. Avoid recreating backend Clean Architecture layers in React merely for symmetry. A server-state cache and a form library can be evaluated with the first workflows; neither needs to become a broad global state framework.

## Backend structure

Proposed baseline: ASP.NET Core 10, PostgreSQL, and EF Core with Npgsql for relational persistence. The runtime and provider findings are recorded in [the research notes](runtime-persistence-research.md). Package selection still requires compatible major versions and supported deployment tooling.

Clean Architecture and business modules solve different problems. I propose inward dependencies for business rules, with modules owning business behavior and publishing narrow contracts. Microsoft's architecture guidance describes keeping the application core independent from infrastructure implementations.[2]

Proposed initial module ownership:

| Area | Owns | Does not own |
| --- | --- | --- |
| Accounts and portfolios | Accounts, grouping, value snapshots, balance provenance | Play editing or venue HTTP calls |
| Journal and plays | Thesis, entered position, entries, planned exits, reviews, manual records, plan revisions | Provider payload formats |
| Strategies | Strategy identity and immutable versions | Rewriting historical plays |
| Venue imports | Connection state, imported execution facts, sync cursors, reconciliation workflow | The trader's thesis or feedback |
| Evidence | Capture metadata, notes, ownership, association with a play | Storage vendor SDKs |

This is a proposed ownership map, not a final list of independent assemblies or databases. Planning calculations can initially live in the Journal domain. Analytics can begin as read models rather than another service.

Each module should have recognizable domain and use-case code plus its persistence mappings. The host composes endpoints and adapters. Do not let modules write directly into another module's internal tables. Keep the number of projects modest; introduce separate assemblies where they enforce a useful boundary, not four assemblies for every small feature.

For LLM-assisted changes, I would optimize for small feature scopes, explicit dependency rules, representative examples, and tests. More projects or abstractions do not automatically make changes safer. Boundary checks should be executable rather than depend on comments alone.

## Domain and application responsibilities

Proposed Domain responsibilities are position arithmetic, sizing rules, entry and exit invariants, valid state changes, version references, and reconciliation rules that operate on already normalized facts.

Application use cases should handle authorization, loading facts, transactions, external-service orchestration, import checkpoints and invoking domain rules. HTTP access, scheduling mechanics, EF mappings, venue SDKs and object storage belong outside the domain.

Before implementing the first calculations, specify units, decimal precision, rounding, contract types, fee/funding treatment, partial fills/exits and the difference between hypothetical and realized results. Imported executions, the original plan, the edited current plan and review notes must not overwrite one another.

Keep calculation functions deterministic and testable. Split a calculation or reconciliation library out when reuse or independent versioning needs it. Do not introduce a generic engine/plugin framework before at least one concrete behavior exists.

## Venue integrations

I recommend a stable application-facing contract implemented by one adapter per venue. Adding a provider should usually mean adding an adapter, capability declaration, configuration/registration and contract tests. A provider with a genuinely new capability may still require a product change.

Prefer separate capabilities for account snapshots, execution history, funding/cash flows and market data over a universal exchange interface with unsupported methods. The initial product remains a read-only diary companion. Wallet signing or order placement is not part of the approved request.

Proposed import path:

```text
Scheduled sync
  -> venue adapter and capability check
  -> normalize source records, retaining provenance
  -> store imported facts idempotently
  -> reconcile facts with journal records through application contracts
  -> update an observable sync checkpoint
```

Import specifications need stable source IDs, handling of duplicate/late/corrected records, pagination, rate limits, credential failure and reconnects. A repeated or retried sync must not double-count a fill or destroy manual feedback. Cursor changes and writes need a deliberate consistency rule.

Venue credentials stay server-side, with suitable secret management or encryption and an explicit key-rotation/recovery policy. Provider contract fixtures must exclude real credentials.

## Persistence boundary

I support isolating PostgreSQL/EF-specific code from domain and use-case code. I do not recommend building a lowest-common-denominator database framework to make PostgreSQL theoretically replaceable.

Proposed persistence ownership:

- EF contexts and mappings, migrations, provider-specific queries, indexes and transaction mechanics belong in the persistence implementation.
- Domain types must not depend on EF or Npgsql. Use-case contracts should not expose `DbContext` or `IQueryable`.
- Prefer intent-specific persistence operations where a boundary is needed. Avoid a generic repository wrapping every entity without adding behavior.
- Keep reporting/query projections separate from aggregate mutation rules; don't load entire plays merely to list summaries.
- Use version/concurrency guards so imports or a second browser tab cannot silently overwrite newer journal edits.

Provider isolation helps localize a future change, but it does not make migration of data, SQL behavior or database features free. Changing databases should remain a deliberate project. Test PostgreSQL-specific behavior against PostgreSQL rather than treat an in-memory provider as equivalent. See the primary-source portability and numeric findings in [the research notes](runtime-persistence-research.md).

## Evidence storage

I recommend an application-facing evidence-storage contract with a local filesystem implementation for the first self-hosted workflow, if that deployment is confirmed. Keep an S3-compatible adapter as the planned replacement, not a mandatory second implementation on day one.

If testing actual S3 API behavior early matters, a local S3-compatible service is the alternative. That adds another service to operate; select the product only after deployment and licensing requirements are known.

Proposed separation:

- PostgreSQL stores evidence IDs, object keys, owner, content type, size, hashes, notes and capture associations.
- Object storage stores the image bytes, not base64 image columns or permanent public URLs.
- Read authorization belongs to the application. Local reads can go through an authenticated endpoint; an S3 adapter may issue short-lived presigned access.
- Apply size/type validation and storage ownership constraints. A file extension alone is not sufficient validation.
- Specify pending/ready upload states and cleanup of failed or orphaned uploads. Database writes and object writes are not one shared transaction.
- Back up both the database and media; a database backup alone would not preserve chart evidence.

Amazon's documentation describes time-limited presigned access without making the object public or distributing the signing credentials to the browser.[3] Compatibility should be tested against the chosen S3-compatible service; a shared API label is not a guarantee of every provider feature.

## Background processing and broker decision

I agree that scheduled imports, retries, backfills and evidence processing need background execution. I would separate three concerns: scheduled triggers, durable work, and business import checkpoints.

An ASP.NET hosted worker gives us an execution host, not durable delivery by itself. Microsoft's queued hosted-service example uses an in-memory queue and warns about graceful shutdown on unexpected termination. Quartz supports persistent job/trigger storage through its relational job store, with PostgreSQL support documented.[4][5]

My proposed starting point is a supported scheduler/job runner with PostgreSQL-backed persistence and application-owned import checkpoints. Quartz.NET is a candidate, not an approved package choice. We must verify scheduling, execution retry and business checkpoint semantics separately; persistent schedules do not guarantee successful exactly-once imports.

The API and worker can initially be hosted together. Keep execution entry points separable so a dedicated worker process can be introduced when long-running imports, resource contention, or deployment isolation justify it. Do not write a new general-purpose queue engine just to avoid a dependency.

Regardless of library, specify:

- Idempotency and duplicate-run behavior.
- Retry/backoff and permanent-failure handling.
- Per-account/provider exclusion, bounded concurrency and rate limiting.
- Recovery after process death and durable checkpoints.
- Job status, cancellation, credential errors and sync visibility to the user.

I would defer a separate message broker until we need independently deployed consumers, fan-out, throughput or service boundaries that justify it. A broker would not remove the need for idempotency, retries or import bookkeeping.

Use an outbox when committing data and requesting external asynchronous delivery must not be separated by a crash. Do not add one to every operation or require event sourcing merely because imports run in the background. The exact transactional work mechanism belongs in the detailed job specification.

## Proposed initial deployment

Subject to the owner's hosting decision:

```text
React SPA
  -> authenticated ASP.NET API
       -> business modules
       -> PostgreSQL
       -> private evidence storage
       -> durable background jobs -> read-only venue adapters
```

This is one product and initially one backend application, not a microservice fleet. A future separate worker would use the same module contracts and persistence rules. No broker, Redis, additional database, plugin runtime or distributed deployment is required solely by the current interface.

Authentication, ownership checks, secret handling, backups and recovery must be in the first production specification. The current unauthenticated LAN prototype is not the security baseline for the real application.

## Alignment status before detailed specifications

The owner confirmed personal single-user, self-hosted operation with token access, future user ownership, Hyperliquid first and Lighter next, manual accounts, TypeScript and the persistence approach. They prefer shadcn/ui as the control base and reusable charts rather than chart-library-driven workflows.

Remaining detailed choices include first contract types, fill-to-play matching, monitoring start/stop and latency, token/session handling, initial media storage implementation and durable job mechanics. See [MVP alignment](mvp-alignment.md) for the current questions.

The read-only nature of integrations is already the current product boundary, not a new question about trade execution.

## Documentation sequence after agreement

First confirm stack and deployment direction. Then write the detailed module ownership map, play/execution/versioning specification, financial-number contract, venue-import contract, background-job semantics, media lifecycle/security rules and frontend/API contracts.

The owner has now authorized the bounded foundation step. Detailed business features must still follow their agreements and specifications rather than infer that scaffold completion implements them. The owner requested a first-part pull request on October 1, 2026 covering the foundation, main shell, read-only integration and management workflows; Play implementation remains the following phase.

## Primary sources

1. [React documentation on building from scratch](https://react.dev/learn/build-a-react-app-from-scratch).
2. [Microsoft guidance on common application architectures and inward dependencies](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures).
3. [Amazon S3 presigned access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
4. [Microsoft queued background tasks and shutdown behavior](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/host/hosted-services).
5. [Quartz.NET persistent job stores](https://www.quartz-scheduler.net/documentation/quartz-4.x/tutorial/job-stores.html).

Support lifecycle, EF provider compatibility and PostgreSQL numeric sources are in [the focused research notes](runtime-persistence-research.md).
