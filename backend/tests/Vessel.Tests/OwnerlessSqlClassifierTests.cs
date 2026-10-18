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
    [InlineData("truncate accounts")]
    [InlineData("lock table accounts in exclusive mode")]
    [InlineData("set search_path to public")]
    [InlineData("do $$ begin delete from accounts; end $$")]
    [InlineData("do 'begin delete from accounts; end'")]
    [InlineData("do E'begin delete from accounts; end'")]
    [InlineData("do language plpgsql $$ begin delete from accounts; end $$")]
    [InlineData("/* outer /* inner */ end */ SELECT * FROM accounts")]
    [InlineData("/* outer /* inner */ end */ truncate accounts")]
    public void Ownerless_or_disguised_sql_needs_review(string sql) => Assert.True(OwnerlessSqlClassifier.RequiresReview(sql));

    [Theory]
    [InlineData("SELECT * FROM accounts WHERE owner_id = @owner")]
    [InlineData("SELECT * FROM accounts WHERE \"Id\" = {id} AND \"OwnerId\" = {db.CurrentOwnerId} FOR UPDATE")]
    [InlineData("/* lookup */ SELECT * FROM accounts a WHERE @ownerId = a.owner_id")]
    [InlineData("DELETE FROM events WHERE owner_id={account.OwnerId}; DELETE FROM event_dedup WHERE owner_id={account.OwnerId};")]
    [InlineData("INSERT INTO notification_cursors(owner_id) VALUES(@owner) ON CONFLICT DO NOTHING")]
    [InlineData("INSERT INTO n(owner_id,content,at) VALUES(@owner,CAST(@content AS jsonb),@now)")]
    [InlineData("INSERT INTO m (\"AccountId\", \"OwnerId\") VALUES ({accountId}, {db.CurrentOwnerId})")]
    [InlineData("INSERT INTO f(owner_id,account_id) SELECT @owner, t.account_id FROM unnest(@accounts) AS t(account_id)")]
    [InlineData("SELECT count(*) FILTER (WHERE state='unread') FROM d WHERE d.owner_id=@owner AND (d.channel='in-app' AND x) LIMIT 1")]
    [InlineData("UPDATE c SET n=n+1 WHERE owner_id=@owner RETURNING n")]
    [InlineData("INSERT INTO h(owner_id,at) VALUES(@owner,@now) ON CONFLICT (owner_id) DO UPDATE SET at=EXCLUDED.at WHERE h.at<EXCLUDED.at")]
    [InlineData("INSERT INTO f(owner_id,a) SELECT @owner, t.a FROM unnest(@a, @b) WITH ORDINALITY AS t(a, b, p) ORDER BY t.p ON CONFLICT DO NOTHING RETURNING a")]
    public void Owner_scoped_sql_passes(string sql) => Assert.False(OwnerlessSqlClassifier.RequiresReview(sql));

    // An owner predicate somewhere in the text is not enough: these read or write other owners' rows.
    [Theory]
    [InlineData("SELECT * FROM accounts WHERE owner_id=@owner OR TRUE")]
    [InlineData("SELECT * FROM accounts WHERE owner_id=@owner UNION ALL SELECT * FROM accounts")]
    [InlineData("WITH scoped AS (SELECT * FROM accounts WHERE owner_id=@owner) DELETE FROM accounts")]
    [InlineData("SELECT 'WHERE owner_id=@owner' AS note, a.* FROM accounts a")]
    [InlineData("INSERT INTO accounts(owner_id,name) VALUES(@owner,'mine'),(@other,'foreign')")]
    [InlineData("UPDATE accounts SET name = 'WHERE owner_id = @owner'")]
    [InlineData("SELECT 'WHERE owner_id = @owner' AS label FROM accounts")]
    [InlineData("SELECT * FROM accounts $q$ WHERE owner_id=@owner $q$")]
    [InlineData("SELECT * FROM accounts E'\\' WHERE owner_id=@owner '")]
    [InlineData("SELECT * FROM accounts /* /* */ WHERE owner_id=@owner */")]
    [InlineData("SELECT * FROM accounts AS \"x WHERE owner_id=@owner\"")]
    [InlineData("SELECT * FROM accounts WHERE NOT owner_id=@owner")]
    [InlineData("SELECT * FROM accounts WHERE owner_id=@owner IS NOT TRUE")]
    [InlineData("SELECT * FROM accounts WHERE x AND (owner_id=@owner AND y) IS NULL")]
    [InlineData("SELECT * FROM accounts a LEFT JOIN plays p ON p.owner_id=@owner")]
    [InlineData("SELECT e.payload FROM events e JOIN event_cursors c ON c.owner_id=@owner AND c.owner_id=e.owner_id")]
    [InlineData("SELECT * FROM accounts a, plays p WHERE a.owner_id=@owner")]
    [InlineData("SELECT (SELECT max(name) FROM accounts) AS leak FROM plays WHERE owner_id=@owner")]
    [InlineData("SELECT * FROM (SELECT * FROM accounts) a WHERE a.owner_id=@owner")]
    [InlineData("SELECT * FROM accounts WHERE owner_id=@owner AND {filter}")]
    [InlineData("UPDATE accounts SET name=p.name FROM plays p WHERE accounts.owner_id=@owner")]
    [InlineData("DELETE FROM accounts USING plays p WHERE accounts.owner_id=@owner")]
    [InlineData("INSERT INTO monitor_accounts(\"AccountId\",\"OwnerId\") VALUES({id},{db.CurrentOwnerId}) ON CONFLICT (\"AccountId\") DO UPDATE SET \"State\"='idle'")]
    [InlineData("INSERT INTO copies(owner_id,name) SELECT @owner, name FROM accounts")]
    [InlineData("INSERT INTO copies(owner_id,name) VALUES(@owner,(SELECT max(name) FROM accounts))")]
    // Ownership transfer: the rows are the owner's, but the assignment hands them to someone else.
    [InlineData("UPDATE accounts SET owner_id=@other WHERE owner_id=@owner")]
    [InlineData("UPDATE accounts a SET name=@n, a.owner_id=@other WHERE a.owner_id=@owner")]
    [InlineData("UPDATE accounts SET \"OwnerId\"={other} WHERE \"OwnerId\"={db.CurrentOwnerId}")]
    [InlineData("UPDATE accounts SET \"owner_id\"=@other WHERE owner_id=@owner")]
    [InlineData("UPDATE accounts SET (name, owner_id)=(@n, @other) WHERE owner_id=@owner")]
    [InlineData("INSERT INTO n(owner_id,id) VALUES(@owner,@id) ON CONFLICT(owner_id,id) DO UPDATE SET owner_id=@other")]
    [InlineData("INSERT INTO n(owner_id,id) VALUES(@owner,@id) ON CONFLICT(owner_id,id) DO UPDATE SET n.\"OwnerId\"=@other RETURNING id")]
    public void Owner_predicates_outside_the_safe_subset_need_review(string sql) =>
        Assert.True(OwnerlessSqlClassifier.RequiresReview(sql));

    [Theory]
    [InlineData("Set ConnectionStrings__Vessel for migration tooling.")]
    [InlineData("Do not switch providers.")]
    [InlineData("/v1/markets/id/{id}/trading-view-data")]
    [InlineData("refresh")]
    [InlineData("reset-after-restore")]
    [InlineData("refresh must be true or false.")]
    [InlineData("Reset complete. Keep all hosts stopped.")]
    [InlineData("Copy failed. Check local files.")]
    [InlineData("Lock callback failed.")]
    [InlineData("Values")]
    [InlineData("Do it again.")]
    [InlineData("/* note /* nested */ still a note */ refresh")]
    public void Prose_is_not_sql(string text) => Assert.False(OwnerlessSqlClassifier.IsSql(text));

    [Fact]
    public void Source_literal_escapes_are_decoded_before_classification()
    {
        Assert.Equal("-- lookup\nSELECT \"Id\"", OwnerlessSqlClassifier.Text("\"-- lookup\\nSELECT \\\"Id\\\"\""));
        Assert.Equal("SELECT \"OwnerId\"", OwnerlessSqlClassifier.Text("$@\"SELECT \"\"OwnerId\"\"\""));
        Assert.True(OwnerlessSqlClassifier.RequiresReview(OwnerlessSqlClassifier.Text("\"-- lookup\\nSELECT * FROM accounts\"")));
        Assert.Equal("SELECT * FROM accounts", OwnerlessSqlClassifier.Text("\"S\\u0045LECT * FROM accounts\""));
        Assert.Equal("SELECT * FROM accounts", OwnerlessSqlClassifier.Text("$\"S\\U00000045LECT * FROM accounts\""));
        Assert.Equal("SELECT * FROM accounts", OwnerlessSqlClassifier.Text("\"S\\x45LECT * FROM accounts\""));
        Assert.Equal("SELECT * FROM accounts", OwnerlessSqlClassifier.Text("\"S\\x0045LECT * FROM accounts\""));
        Assert.Equal("\a\b\f\v\u001b\0x", OwnerlessSqlClassifier.Text("\"\\a\\b\\f\\v\\e\\0x\""));
        Assert.Equal("\U0001F600", OwnerlessSqlClassifier.Text("\"\\U0001F600\""));
        Assert.True(OwnerlessSqlClassifier.RequiresReview(OwnerlessSqlClassifier.Text("\"S\\u0045LECT * FROM accounts\"")));
        Assert.True(OwnerlessSqlClassifier.RequiresReview(OwnerlessSqlClassifier.Text("$\"\\x44\\x45LETE FROM accounts\"")));
    }
}
