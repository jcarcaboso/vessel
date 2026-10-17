namespace Vessel.Tests.Isolation;

/// <summary>
/// Contract §12 C1: another user's session or wallet ID answers like an unknown one. The routes come from lane A2
/// (`/api/auth/sessions/{id}`, `/api/auth/wallets/{id}`) and need Wallet-mode sign-in, which this base lacks.
/// </summary>
public sealed class AuthIsolationTests
{
    private const string Pending = "pending A2: /api/auth/sessions and /api/auth/wallets do not exist on this base.";

    [Fact(Skip = Pending)]
    public void Foreign_session_id_is_not_found_like_an_unknown_one()
    {
        // DELETE /api/auth/sessions/{id} with another user's session: 404 not-found, identical to a random ID,
        // and the other user's session stays live.
    }

    [Fact(Skip = Pending)]
    public void Foreign_wallet_id_is_not_found_like_an_unknown_one()
    {
        // PATCH and DELETE /api/auth/wallets/{id} with another user's wallet: 404 not-found, identical to a random ID,
        // and the other user's wallet label and sessions are unchanged.
    }

    [Fact(Skip = Pending)]
    public void Session_and_wallet_lists_never_include_the_other_user()
    {
        // GET /api/auth/sessions and GET /api/auth/wallets list only the signed-in user's rows.
    }
}
