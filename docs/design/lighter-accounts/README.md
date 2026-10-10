# Lighter account recordings

Recorded October 7, 2026, with the import clip updated October 8, against the application UI with synthetic API fixtures. Wallet addresses, account names, balances and masked tokens are made up. These clips do not show a live venue connection or prove server-side token verification.

## Desktop account import

[Full-resolution MP4](import-desktop.mp4), 31 seconds, 1152 × 960.

Discover a wallet and compare collateral and available balances. Load Lighter names with an optional read-only token, then select two subaccounts using those names. The lookup clears the token without saving it. Re-enter it for order access at import. Both accounts import; one simulated token save fails and gets its own recovery message. The already imported disabled main account cannot be selected. Returning to Overview does not refresh history.

![Desktop account import](import-desktop.gif)

## Mobile credential management

[Full-resolution MP4](credentials-mobile.mp4), 25 seconds, 390 × 844.

Inspect an expiring token, replace it through the masked input, cancel removal once, then confirm removal. The final state explains that public account reads remain available.

![Mobile credential management](credentials-mobile.gif)

The browser checks reported no page errors and confirmed that no read-only token was retained in local or session storage. The import check also confirmed that no history-sync request was made.
