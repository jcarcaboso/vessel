# Runtime and persistence research

Research only, not an accepted decision. As of September 30, 2026.

ASP.NET Core 10, PostgreSQL, modular clean boundaries and isolated persistence are proposals. This note follows Vessel's [brief](../project-brief.md), [glossary](../../CONTEXT.md) and [approved visual baseline](../design/approved-baseline.md); it imports no architecture from the separate Trading Diary GitLab project. No implementation is authorized here.

## Verified facts

### Runtime and provider compatibility

- .NET 10 is LTS, released **November 11, 2025**. The support policy, marked updated **September 8, 2026**, lists scheduled end of support **November 14, 2028**, covers ASP.NET Core and requires released patch updates. The dated launch article instead says **November 10, 2028**; preserve this discrepancy rather than treating the articles as identical. No current patch is pinned here. [1], [6]
- EF Core 10 requires the .NET 10 SDK and runtime. [2]
- Npgsql's EF provider **10** aligns with EF Core **10** and targets `net10.0`. The initial stable package's dependency range excludes EF Core 11 (`>=10.0.0, <11.0.0`). That historical package is compatibility evidence, not a current patch recommendation or a Vessel-tested combination. [3]

### What persistence isolation cannot guarantee

- EF Core does not abstract every database behavior. Identical LINQ can produce different results; collations/case sensitivity, query support, provider-specific functions and raw SQL dialects differ. Tests against another provider cannot establish PostgreSQL correctness. [4]
- EF tooling generates migrations for the active provider. Supporting multiple providers requires separate migration sets, updated for every model change. [5]

My inference is that boundaries can contain replacement work, not eliminate it. A future switch still needs query/mapping changes, destination migrations, a data-transfer plan and verification against the destination database. Separate persistence does not itself establish semantic portability. [4], [5]

### Exact numbers

- PostgreSQL `numeric`/`decimal` are equivalent exact-decimal types; addition, subtraction and multiplication are exact where possible. `real`/`double precision` are inexact. “Exact” is not unlimited precision for every calculation. [7]
- For conventional `numeric(p,s)` with `0 <= s <= p`, input is rounded to scale `s`, then rejected if integer digits exceed `p-s`. Midpoint ties round **away from zero**. Unconstrained `numeric` imposes no declared scale. `NaN` is permitted; infinities require unconstrained numeric. [7]
- Npgsql maps numeric to .NET `decimal` by default, but .NET decimal has only **28–29 significant digits**. Thus PostgreSQL's larger numeric capacity does not guarantee a lossless application round-trip. Default decimal `Math.Round` uses **ties-to-even**, unlike PostgreSQL numeric rounding. [7], [8], [9], [10]
- PostgreSQL `money` has locale-dependent fractional precision/output; integer division truncates, and money/money returns `double precision`. It is not interchangeable with numeric. [11]

## Recommendations, pending approval

Keep provider-dependent queries, mappings and migrations inside persistence; verify the chosen package's dependency constraints when implementation is approved. Prefer PostgreSQL integration tests over a speculative second provider. These are recommendations, not approved boundaries or schema choices. [3], [4], [5]

Consider decimal/numeric for money, prices and quantities, with explicit field-specific precision, scale, units and rounding rules rather than a blanket two-decimal scale. First establish maximum values and intermediate calculation bounds; reject non-finite values and test rounding, overflow and round-trips. Avoid `money`. PostgreSQL capacity alone does not settle the application's numeric contract. [7], [8], [9], [10], [11]

## Primary sources

[1]: https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core
[2]: https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew
[3]: https://www.nuget.org/packages/Npgsql.EntityFrameworkCore.PostgreSQL/10.0.0
[4]: https://learn.microsoft.com/en-us/ef/core/testing/choosing-a-testing-strategy
[5]: https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/providers
[6]: https://devblogs.microsoft.com/dotnet/announcing-dotnet-10/
[7]: https://www.postgresql.org/docs/18/datatype-numeric.html
[8]: https://www.npgsql.org/doc/types/basic.html
[9]: https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/floating-point-numeric-types
[10]: https://learn.microsoft.com/en-us/dotnet/api/system.math.round?view=net-10.0
[11]: https://www.postgresql.org/docs/18/datatype-money.html
