# Lighter execution import investigation

October 16, 2026. The correction is local code only, not deployed. No production
refresh, migration, account write or configuration change was performed.

## Observations

A consistent read-only database dump and non-secret diagnostics from `krb-crt-01`
were captured for isolated reproduction. API and web ran `0.1.3`, revision
`782ecdb6dd7bb306fe96bb13d1cbe109c40ea559`. Neither Lighter account had a stored
read-only token.

Bounded unauthenticated Robinhood Lighter reads established:

- Thirty ordinary trade executions, all omitting protocol and integrator fee fields.
- Twenty opens/increases with account PnL absent, and ten reductions/flips with
  account PnL present. This classification uses the queried account's side and
  maker/taker signed position before each execution.
- No next cursor, which does not establish complete lifetime history.
- `accountLimits` returned HTTP 400, code `20001`, for missing authentication.
  The public account response contained no tier fields. An extra public tier
  lookup therefore cannot fix this case.

Raw captures, account identifiers, balances, tokens and dump locations remain
outside the repository. The restored database is isolated without a network or
published ports; its container is stopped.

## First-party semantics

Both the [mainnet entry bundle][mainnet-entry] and [Robinhood entry bundle][rh-entry]
load `assets/dist-CqSTwP7I.js`. Downloads of the [mainnet][mainnet-dist] and
[Robinhood][rh-dist] shared bundles were byte-identical, with SHA-256
`0b09cdcd4ed28f9aa4be5948c58deedf4166929860942b5690d2ad4ff67e85a0`.

REST trade mapper `Rf` explicitly defaults absent/null `maker_fee`, `taker_fee`
and both `integrator_*_fee` fields through `?? 0`. WebSocket mapper `Oy` does the
same. Nonzero values survive. This establishes the first-party client convention,
not a verified backend serializer implementation. The [original integration
research][prior-fees] also recorded fee rates as absent when zero.

The [official Trade model][sdk-trade] describes account PnL as realized on a
position reduction. Client helper `Xj` uses the account's position before the
execution and returns no closed PnL for non-reductions. For reductions, it uses
reported PnL or computes a fallback. Vessel does not adopt that fallback.

A verified perpetual open/increase has zero realized closing PnL. Missing PnL on
a close or flip remains unknown. This is not a blanket rule that omitted PnL
means zero. The SDK declares account PnL and integrator fees required despite
the observed omissions, so its required-field declarations alone are insufficient.

## Root cause and correction

The [deployed reader][deployed-reader] requires either an explicit zero fee rate
or authenticated Standard-tier verification. With neither, it rejects the row
before examining PnL. That explains all thirty fee/unverified-fee skips. Fixing
only that check would still omit the twenty openings because of the separate
required-PnL check.

The shared adapter now:

- Normalizes absent/null trade fee ticks to zero, matching both official clients.
- Records zero realized PnL only for opens/increases established from the queried
  account's side and signed pre-execution position. Reported PnL remains exact.
- Continues omitting closes/flips without reported PnL and executions with nonzero
  applicable protocol or integrator fees. Malformed values still fail validation.
- Preserves the existing authenticated nonzero-current-tier exclusion and the
  liquidation, deleverage, settlement and self-trade exclusions.
- Keeps absent reported PnL and protocol fee ticks null in the sanitized raw
  projection rather than claiming normalized zeros were explicitly reported.

No fee formula, reconstructed closing PnL, nullable financial contract, persistence
change or schema migration is needed. Public imports do not label accounts
Standard. [Order tracking][deployed-orders] still requires a verified `ro:` token;
[credential storage and transport protections](venue-credentials.md) are unchanged.

## Verification

- Before the fix, the adapter regression run failed twenty tests and passed 102.
- After the fix, the full backend suite passed 1,762 tests with 137 opt-in tests
  skipped, 1,899 total. Database and live opt-ins were disabled.
- The Release build passed with zero warnings and errors.
- An offline replay of the actual captured Robinhood response retained all thirty
  executions: thirty zero-fee executions, twenty zero-realized-PnL openings, and
  ten reductions/flips retaining reported PnL. Fee and PnL omission counts were
  both zero, and every fill passed normalized-fact validation.
- The replay made no requests or database writes and ran no migrations. The
  private dump hash is unchanged; its file mode is `0600` and directory `0700`.

Synthetic regressions cover both exchanges, side/role selection, absent/null fees,
malformed and nonzero fees, absent/null/empty PnL on opens versus closes/flips,
and a credentialless thirty-execution page. Financial inputs stay synthetic.

The replay verifies parsing, not a live import. Production still needs a separately
authorized deployment and refresh. Bounded history limits remain unchanged.
See [implementation state](lighter-state.md).

## Sources

Public assets were checked on October 16, 2026. Bundle symbol names are not a
stable API. SDK references pin commit `5825eb19867a4dbdd47c02642dc1eec30c30ca73`;
Vessel diagnosis references pin the deployed revision.

[mainnet-entry]: https://app.lighter.xyz/assets/index-m1O2jQ2J.js
[rh-entry]: https://robinhoodchain.lighter.xyz/assets/index-CcBDGVCE.js
[mainnet-dist]: https://app.lighter.xyz/assets/dist-CqSTwP7I.js
[rh-dist]: https://robinhoodchain.lighter.xyz/assets/dist-CqSTwP7I.js
[sdk-trade]: https://github.com/elliottech/lighter-python/blob/5825eb19867a4dbdd47c02642dc1eec30c30ca73/lighter/models/trade.py#L43-L66
[prior-fees]: https://github.com/jcarcaboso/vessel/blob/782ecdb6dd7bb306fe96bb13d1cbe109c40ea559/docs/architecture/lighter-integration.md#L40-L48
[deployed-reader]: https://github.com/jcarcaboso/vessel/blob/782ecdb6dd7bb306fe96bb13d1cbe109c40ea559/backend/src/Vessel.Infrastructure/Venues/Lighter/LighterReader.Account.cs#L37-L265
[deployed-orders]: https://github.com/jcarcaboso/vessel/blob/782ecdb6dd7bb306fe96bb13d1cbe109c40ea559/backend/src/Vessel.Infrastructure/Venues/Lighter/LighterReader.Orders.cs#L16-L53
