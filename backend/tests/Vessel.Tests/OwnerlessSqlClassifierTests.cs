namespace Vessel.Tests;

public sealed class OwnerlessSqlClassifierTests
{
    [Theory]
    [InlineData("/* account lookup */ SELECT * FROM accounts")]
    [InlineData("-- account lookup\nSELECT * FROM accounts")]
    [InlineData("  \n (SELECT * FROM accounts) UNION ALL (SELECT * FROM accounts)")]
    [InlineData("select * from accounts")]
    [InlineData("SELECT @owner AS requested_owner, a.* FROM accounts a")]
    [InlineData("SELECT a.owner_id = @owner AS mine, a.* FROM accounts a")]
    [InlineData("SELECT * FROM accounts WHERE \"Id\" = @id OR owner_id = @owners")]
    [InlineData("SELECT * FROM accounts -- WHERE owner_id = @owner")]
    [InlineData("SELECT * FROM accounts /* AND owner_id = @owner */")]
    [InlineData("DELETE FROM events WHERE owner_id=@owner; DELETE FROM event_dedup")]
    [InlineData("INSERT INTO events(owner_id,event_id) VALUES(@other,@owner)")]
    [InlineData("INSERT INTO events(event_id,payload) VALUES(@id,@owner)")]
    [InlineData("TRUNCATE accounts")]
    [InlineData("LOCK TABLE accounts IN EXCLUSIVE MODE")]
    [InlineData("SET TRANSACTION READ ONLY")]
    [InlineData("MERGE INTO accounts a USING staged s ON a.\"Id\" = s.id WHEN MATCHED THEN DELETE")]
    public void Ownerless_or_disguised_sql_needs_review(string sql) => Assert.True(OwnerlessSqlClassifier.RequiresReview(sql));

    [Theory]
    [InlineData("SELECT * FROM accounts WHERE owner_id = @owner")]
    [InlineData("SELECT * FROM accounts WHERE \"Id\" = {id} AND \"OwnerId\" = {db.CurrentOwnerId} FOR UPDATE")]
    [InlineData("/* lookup */ SELECT * FROM accounts a WHERE @ownerId = a.owner_id")]
    [InlineData("SELECT e.payload FROM events e JOIN event_cursors c ON c.owner_id=@owner AND c.owner_id=e.owner_id")]
    [InlineData("DELETE FROM events WHERE owner_id={account.OwnerId}; DELETE FROM event_dedup WHERE owner_id={account.OwnerId};")]
    [InlineData("INSERT INTO notification_cursors(owner_id) VALUES(@owner) ON CONFLICT DO NOTHING")]
    [InlineData("INSERT INTO n(owner_id,content,at) VALUES(@owner,CAST(@content AS jsonb),@now)")]
    [InlineData("INSERT INTO m (\"AccountId\", \"OwnerId\") VALUES ({accountId}, {db.CurrentOwnerId})")]
    [InlineData("INSERT INTO f(owner_id,account_id) SELECT @owner, t.account_id FROM unnest(@accounts) AS t(account_id)")]
    public void Owner_scoped_sql_passes(string sql) => Assert.False(OwnerlessSqlClassifier.RequiresReview(sql));

    [Theory]
    [InlineData("Set ConnectionStrings__Vessel for migration tooling.")]
    [InlineData("Do not switch providers.")]
    [InlineData("/v1/markets/id/{id}/trading-view-data")]
    public void Prose_is_not_sql(string text) => Assert.False(OwnerlessSqlClassifier.IsSql(text));

    [Fact]
    public void Source_literal_escapes_are_decoded_before_classification()
    {
        Assert.Equal("-- lookup\nSELECT \"Id\"", OwnerlessSqlClassifier.Text("\"-- lookup\\nSELECT \\\"Id\\\"\""));
        Assert.Equal("SELECT \"OwnerId\"", OwnerlessSqlClassifier.Text("$@\"SELECT \"\"OwnerId\"\"\""));
        Assert.True(OwnerlessSqlClassifier.RequiresReview(OwnerlessSqlClassifier.Text("\"-- lookup\\nSELECT * FROM accounts\"")));
    }
}
