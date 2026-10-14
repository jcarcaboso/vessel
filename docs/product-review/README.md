# Vessel product review

The current review is **October 13, 2026**, at `7559248f838068faff8cf8146844a031bc2a67c9`. It replaces the earlier missing-feature and bug assessment at `a51c7f2`, after a fast-forward pull of 129 commits.

The owner subsequently authorized the six bug fixes and all P1 must-haves.
Implementation and integrated checks are complete under VESSEL-43 and
VESSEL-44. Both independent adversarial review tracks cleared the final fixes
on October 14. Read the
[delivery contract](../architecture/diary-completion-contract.md) for the
authorized scope and the [verification receipt](verification/2026-10-13-p1.md)
for current results and application captures. The review itself remains a
snapshot of the baseline, not a list of unresolved defects in this branch.

[PR #37](https://github.com/jcarcaboso/vessel/pull/37) contains the verified
delivery and captures. It is open, not merged or deployed.

## Read first

**LAN summary:** [http://10.1.0.219:5197/](http://10.1.0.219:5197/)

The old port 5190 now serves a separate proposal. It was left untouched, as were the existing app service, owner database and credentials.

| File | What it answers |
| --- | --- |
| [P1 delivery verification](verification/2026-10-13-p1.md) | Implemented must-haves, adversarial findings/fixes, test results, limits and synthetic captures |
| [next-steps.html](next-steps.html) | Development order from release blockers and must-haves to optional features |
| [2026-10-13-development-roadmap.md](2026-10-13-development-roadmap.md) | Bounded deliveries, dependencies, examples and completion criteria |
| [2026-10-13.html](2026-10-13.html) | Quick visual summary of completed work, six defects, priorities, examples and screenshots |
| [2026-10-13-review.md](2026-10-13-review.md) | Consolidated recommendation, bugs, required work, UX improvements, nice-to-haves and verification |
| [2026-10-13-backend-audit.md](2026-10-13-backend-audit.md) | Five backend defects with exact source references, reproduction inputs and acceptance tests |
| [2026-10-13-product-delta.md](2026-10-13-product-delta.md) | M1–M10 and G/I/N/X mappings; concrete product scenarios; current official-source checks |
| [verification/](verification/) | Probe source, execution receipts and check summary |
| [screenshots/2026-10-13/](screenshots/2026-10-13/) | Current app captures using only synthetic account/execution data |

## Main recommendation

The branch now fixes execution integrity and evidence-note save races, supports
manual executions and retrospective reviews, adds the whole-position money
summary, and extends reviews with optional structured fields and history.
After verification and merge, the next proposed work is bounded history
coverage/backfill and opt-in tracking. P2/P3 are not authorized by this delivery.

The review itself did not change application code. The owner subsequently
requested Claude Opus fixes for R1–R6, tracked as
[VESSEL-43](https://kanban.testing.alpetxino.com/working-projects/browse/VESSEL-43),
and Sol implementation of P1 under
[VESSEL-44](https://kanban.testing.alpetxino.com/working-projects/browse/VESSEL-44).
The [roadmap](next-steps.html) keeps later features separate.
[VESSEL-42](https://kanban.testing.alpetxino.com/working-projects/browse/VESSEL-42)
tracks the original review; durable context is in
[Outline](https://outline.testing.alpetxino.com/doc/vessel-edURkJD0Hp).

## Serving and stopping

The transient user service `vessel-product-review-20261013` serves only this directory, bound to `10.1.0.219:5197`. Its firewall rule permits `10.1.0.0/24` arriving on `ens18`, not the public internet. The service and rule are not persistent across reboot; a firewall rebuild can also remove the rule.

Desktop and 390/320 px browser checks passed for the summary. Document/image links returned HTTP 200, images decoded, and section anchors stayed clear of the sticky navigation. This verifies the host and browser preview, not a connection from the owner's separate LAN device.

Stop this review only:

```sh
systemctl --user stop vessel-product-review-20261013
sudo iptables -D nixos-fw -s 10.1.0.0/24 -d 10.1.0.219/32 -i ens18 -p tcp --dport 5197 -m comment --comment vessel-product-review-20261013-lan -j nixos-fw-accept
```

The synthetic app/API/database used for verification are separate from this static service and are stopped after the review.

## Historical material

The October 2/3 documents remain for reasoning and original examples, **not as current app findings**. Competitor prices and plans were not re-audited in this update.

- [Original index and review process](README-2026-10-02.md)
- [Previous HTML summary](index-2026-10-02.html)
- [Original trader review](trader-review.md)
- [Original UI audit](ui-ux-audit.md)
- [Original roadmap](roadmap.md)
- [Competitor benchmark](competitors.md)

The partial mockup remains historical and unfinished. It is not the current application. The interrupted standalone accessibility audit and technical-specification effort was not silently declared complete by this refresh.
