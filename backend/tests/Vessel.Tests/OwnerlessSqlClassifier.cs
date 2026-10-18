using System.Text;
using System.Text.RegularExpressions;

namespace Vessel.Tests;

/// <summary>
/// Decides which C# string literals are raw SQL that needs an entry in the reviewed ownerless inventory
/// (contract §9.1). It is deliberately conservative: a literal is exempt only when every statement in it
/// carries an owner predicate in a WHERE/ON/AND position or inserts the owner value into the owner column.
/// </summary>
internal static class OwnerlessSqlClassifier
{
    // Core DML starters keep the original case-insensitive match; the other statement starters are SQL-style
    // upper case only, so prose such as "Set ConnectionStrings__Vessel" or "Do not switch" is not SQL.
    private static readonly Regex CoreStarter = new(@"^(SELECT|INSERT|UPDATE|DELETE|WITH)\b", RegexOptions.IgnoreCase);
    private static readonly Regex OtherStarter = new(
        @"^(MERGE|TRUNCATE|LOCK|CALL|COPY|DO|SET|RESET|VALUES|TABLE|EXPLAIN|CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|" +
        @"REFRESH|VACUUM|ANALYZE|REINDEX|CLUSTER|DISCARD|NOTIFY|LISTEN|UNLISTEN|PREPARE|EXECUTE|DECLARE|FETCH|MOVE|IMPORT)\b");
    private static readonly Regex LeadingNoise = new(@"^(?:\s+|\(|--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)+");
    private static readonly Regex Comments = new(@"--[^\n]*|/\*[\s\S]*?\*/");

    private const string OwnerColumn = @"(?:\w+\.)?(?:owner_id|""OwnerId"")";
    private const string OwnerValue = @"(?:@owner(?:Id)?\b|\{\s*(?:[\w.]+\.)?(?:Current)?Owner(?:Id)?(?:\.Value)?\s*\})";
    private static readonly Regex OwnerPredicate = new(
        $@"\b(?:WHERE|ON|AND)\s+\(?\s*(?:{OwnerColumn}\s*=\s*{OwnerValue}|{OwnerValue}\s*=\s*{OwnerColumn})",
        RegexOptions.IgnoreCase);
    private static readonly Regex OwnerColumnOnly = new($"^{OwnerColumn}$", RegexOptions.IgnoreCase);
    private static readonly Regex OwnerValueOnly = new($"^{OwnerValue}$", RegexOptions.IgnoreCase);
    private static readonly Regex InsertTarget = new(@"\bINSERT\s+INTO\s+[\w.""]+\s*\(", RegexOptions.IgnoreCase);

    /// <summary>The SQL text a source literal token (including its quotes and $/@ prefix) produces at runtime.</summary>
    public static string Text(string token)
    {
        var literal = token.TrimStart('$');
        var raw = literal.StartsWith("\"\"\"", StringComparison.Ordinal);
        var verbatim = !raw && literal.StartsWith('@');
        var quote = raw ? 3 : 1;
        var body = literal[((verbatim ? 1 : 0) + quote)..^quote];
        if (raw) return body;
        if (verbatim) return body.Replace("\"\"", "\"", StringComparison.Ordinal);
        var text = new StringBuilder(body.Length);
        for (var i = 0; i < body.Length; i++)
        {
            if (body[i] != '\\' || i + 1 == body.Length) { text.Append(body[i]); continue; }
            var next = body[++i];
            text.Append(next switch { 'n' => '\n', 'r' => '\r', 't' => '\t', '0' => '\0', _ => next });
        }
        return text.ToString();
    }

    /// <summary>True when the text is a SQL statement (after leading comments, whitespace and parentheses).</summary>
    public static bool IsSql(string text)
    {
        var start = LeadingNoise.Replace(text, "", 1);
        return CoreStarter.IsMatch(start) || OtherStarter.IsMatch(start);
    }

    /// <summary>True when the text is SQL and at least one of its statements is not provably owner scoped.</summary>
    public static bool RequiresReview(string text) =>
        IsSql(text) && Comments.Replace(text, " ").Split(';').Any(s => !string.IsNullOrWhiteSpace(s) && !OwnerScoped(s));

    private static bool OwnerScoped(string statement) =>
        OwnerPredicate.IsMatch(statement) || InsertTarget.Matches(statement).Any(m => InsertsOwner(statement, m.Index + m.Length));

    // An INSERT writes its own owner when the value at the owner column's position is the owner parameter.
    private static bool InsertsOwner(string statement, int columnsStart)
    {
        var columns = TopLevel(statement, columnsStart, out var after);
        var owner = columns.FindIndex(c => OwnerColumnOnly.IsMatch(c));
        if (owner < 0) return false;
        var rest = statement[after..];
        var values = Regex.Match(rest, @"^\s*VALUES\s*\(", RegexOptions.IgnoreCase);
        var select = Regex.Match(rest, @"^\s*SELECT\s+", RegexOptions.IgnoreCase);
        var row = values.Success ? TopLevel(rest, values.Length, out _)
            : select.Success ? SelectList(rest[select.Length..]) : [];
        return owner < row.Count && OwnerValueOnly.IsMatch(row[owner]);
    }

    // Splits the comma-separated list that starts after an opening parenthesis, up to its closing parenthesis.
    private static List<string> TopLevel(string text, int start, out int end)
    {
        var items = new List<string>();
        var depth = 0;
        var item = start;
        for (end = start; end < text.Length; end++)
        {
            var c = text[end];
            if (c is '(' or '{') depth++;
            else if (c is '}' || c == ')' && depth > 0) depth--;
            else if (c == ')') { items.Add(text[item..end].Trim()); end++; return items; }
            else if (c == ',' && depth == 0) { items.Add(text[item..end].Trim()); item = end + 1; }
        }
        return [];
    }

    // The select list of INSERT ... SELECT, ending at its top-level FROM (subqueries in the list are skipped).
    private static List<string> SelectList(string text)
    {
        var depth = 0;
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] is '(' or '{') depth++;
            else if (text[i] is ')' or '}') depth--;
            else if (depth == 0 && Regex.IsMatch(text[i..], @"^\bFROM\b", RegexOptions.IgnoreCase) &&
                     (i == 0 || !char.IsLetterOrDigit(text[i - 1]) && text[i - 1] != '_'))
                return TopLevel(text[..i] + ")", 0, out _);
        }
        return TopLevel(text + ")", 0, out _);
    }
}
