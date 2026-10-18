using System.Text;
using System.Text.RegularExpressions;

namespace Vessel.Tests;

/// <summary>
/// Decides which C# string literals are raw SQL that needs an entry in the reviewed ownerless inventory
/// (contract §9.1). Only a small, demonstrably owner-safe subset is exempt; everything else is reviewed:
/// <list type="bullet">
/// <item>a single-table SELECT, UPDATE or DELETE whose top-level WHERE has an exact owner-equality conjunct;</item>
/// <item>a single-row INSERT whose owner column receives the owner value (or an INSERT … SELECT from an owner-scoped
/// single table or from <c>unnest</c> of parameters), with ON CONFLICT DO UPDATE only on a target that includes the owner column.</item>
/// </list>
/// Neither may assign an owner column (UPDATE SET or ON CONFLICT DO UPDATE SET), which would move rows to another owner.
/// Comments (nested, also before the statement keyword), quoted strings and quoted identifiers are removed first. CTEs, set operations, OR, NOT/IS around the
/// owner predicate, joins, subqueries, multi-row VALUES and text spliced into parameterised SQL are never exempt.
/// Interpolation holes in SQL without @parameters are taken as EF Core parameters.
/// </summary>
internal static class OwnerlessSqlClassifier
{
    private const RegexOptions Ci = RegexOptions.IgnoreCase;

    // Core DML starters keep the original case-insensitive match. The other statement starters match in SQL-style
    // upper case, or in any case when the next tokens follow that statement's grammar, so prose such as
    // "Set ConnectionStrings__Vessel", "Do not switch" or "refresh" is not SQL while "truncate accounts" is.
    private static readonly Regex CoreStarter = new(@"^(SELECT|INSERT|UPDATE|DELETE|WITH)\b", Ci);
    private static readonly Regex OtherStarter = new(
        @"^(MERGE|TRUNCATE|LOCK|CALL|COPY|DO|SET|RESET|VALUES|TABLE|EXPLAIN|CREATE|ALTER|DROP|GRANT|REVOKE|COMMENT|" +
        @"REFRESH|VACUUM|ANALYZE|REINDEX|CLUSTER|DISCARD|NOTIFY|LISTEN|UNLISTEN|PREPARE|EXECUTE|DECLARE|FETCH|MOVE|IMPORT)\b");
    private static readonly Regex AnyCaseStarter = new(OtherStarter.ToString(), Ci);
    private const string Name = @"[\w.""]+";
    private const string Ddl = @"\s+(?:or\s+replace\s+|unique\s+|temp(?:orary)?\s+|unlogged\s+|global\s+|local\s+|materialized\s+|" +
        @"foreign\s+|default\s+|event\s+|text\s+search\s+|access\s+method\s+|large\s+object\s+|if\s+(?:not\s+)?exists\s+)*" +
        @"(?:table|index|view|schema|function|procedure|trigger|type|extension|sequence|role|user|group|database|policy|domain|" +
        @"aggregate|operator|rule|publication|subscription|server|statistics|collation|cast|conversion|language|tablespace|" +
        @"transform|privileges|owned|routine|wrapper|data|mapping|template|parser|dictionary|configuration)\b";
    private const string Privilege = @"\s+(?:all|select|insert|update|delete|truncate|references|trigger|usage|create|connect|" +
        @"temporary|temp|execute|maintain|set|alter\s+system|grant\s+option\s+for|admin\s+option\s+for)\b|\s+[\w""]+(?:\s*,\s*[\w""]+)*\s+(?:to|from)\b";
    private const string Maintenance = @"\s*(?:$|;|\()|\s+(?:full|freeze|verbose|analyze|skip_locked)\b|\s+" + Name + @"\s*(?:$|[;,(])";
    private const string Fetch = @"\s+(?:next|prior|first|last|absolute|relative|all|forward|backward|from|in|[-+]?\d+)\b";
    private static readonly Dictionary<string, Regex> StatementGrammar = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["MERGE"] = @"\s+into\b",
        ["TRUNCATE"] = @"\s+(?:table\s+)?(?:only\s+)?" + Name + @"\s*(?:[,;*]|$|restart\b|continue\b|cascade\b|restrict\b)",
        ["LOCK"] = @"\s+(?:table\s+)?(?:only\s+)?" + Name + @"\s*(?:[,;*]|$|in\b|nowait\b)",
        ["CALL"] = @"\s+" + Name + @"\s*\(",
        ["COPY"] = @"\s*\(|\s+" + Name + @"\s*(?:\(|from\b|to\b)",
        ["DO"] = @"\s*(?:\$|')|\s+(?:e'|u&'|language\b)",
        ["SET"] = @"\s+(?:session|local|transaction|constraints|role|time\s+zone|names|schema|search_path)\b|\s+[\w.]+\s*(?:=|to\b)",
        ["RESET"] = @"\s+(?:all|role|session\s+authorization|[\w.]+)\s*(?:;|$)",
        ["VALUES"] = @"\s*\(",
        ["TABLE"] = @"\s+(?:only\s+)?" + Name + @"\s*\*?\s*(?:;|$)",
        ["EXPLAIN"] = @"\s*\(|\s+(?:analyze|verbose|select|insert|update|delete|merge|with|values|table|execute|create|declare)\b",
        ["CREATE"] = Ddl, ["ALTER"] = Ddl, ["DROP"] = Ddl,
        ["GRANT"] = Privilege, ["REVOKE"] = Privilege,
        ["COMMENT"] = @"\s+on\b",
        ["REFRESH"] = @"\s+materialized\b",
        ["VACUUM"] = Maintenance, ["ANALYZE"] = Maintenance,
        ["REINDEX"] = @"\s*\(|\s+(?:index|table|schema|database|system)\b",
        ["CLUSTER"] = @"\s*(?:$|;|\()|\s+verbose\b|\s+" + Name + @"\s*(?:$|;|using\b)",
        ["DISCARD"] = @"\s+(?:all|plans|sequences|temp|temporary)\b",
        ["NOTIFY"] = @"\s+\w+\s*(?:$|[;,])",
        ["LISTEN"] = @"\s+(?:\w+|\*)\s*(?:$|;)", ["UNLISTEN"] = @"\s+(?:\w+|\*)\s*(?:$|;)",
        ["PREPARE"] = @"\s+transaction\b|\s+\w+\s*(?:\(|as\b)",
        ["EXECUTE"] = @"\s+\w+\s*(?:\(|;|$)",
        ["DECLARE"] = @"\s+\w+\s+(?:(?:binary|asensitive|insensitive|no|scroll)\s+)*cursor\b",
        ["FETCH"] = Fetch, ["MOVE"] = Fetch,
        ["IMPORT"] = @"\s+foreign\s+schema\b",
    }.ToDictionary(p => p.Key, p => new Regex(@"^(?:" + p.Value + ")", Ci), StringComparer.OrdinalIgnoreCase);

    private const string OwnerColumn = @"(?:\w+\.)?(?:owner_id|""OwnerId"")";
    private const string OwnerValue = @"(?:@owner(?:Id)?\b|\{\s*(?:[\w.]+\.)?(?:Current)?Owner(?:Id)?(?:\.Value)?\s*\})";
    private const string Table = @"(?:(?:\w+|""_"")\.)?(?:\w+|""_"")";
    // Any mention of an owner column, quoted or not, qualified or not, in any case: assigning one moves rows between owners.
    private static readonly Regex OwnerMention = new(@"(?<![\w""])(?:owner_?id|""owner_?id"")(?![\w""])", Ci);
    private static readonly Regex OwnerEquality = new($@"^(?:{OwnerColumn}\s*=\s*{OwnerValue}|{OwnerValue}\s*=\s*{OwnerColumn})$", Ci);
    private static readonly Regex OwnerColumnOnly = new($"^{OwnerColumn}$", Ci);
    private static readonly Regex OwnerValueOnly = new($"^{OwnerValue}$", Ci);
    private static readonly Regex Unsupported = new(
        @"\b(?:OR|UNION|INTERSECT|EXCEPT|JOIN|USING|LATERAL|BETWEEN)\b|\bWITH\b(?!\s+ORDINALITY\b)|\(\s*(?:SELECT|VALUES|TABLE|WITH)\b", Ci);
    private static readonly Regex SingleTable = new($@"^\s*{Table}(?:\s+(?:AS\s+)?\w+)?\s*$", Ci);
    private static readonly Regex InsertHead = new($@"^INSERT\s+INTO\s+{Table}(?:\s+AS\s+\w+)?\s*\(", Ci);
    private static readonly Regex InsertTail = new(
        @"^\s*(?:ON\s+CONFLICT\s*(?:\((?<target>[^()]*)\))?\s*DO\s+(?:NOTHING|(?<update>UPDATE\s+SET\b[\s\S]*?)))?\s*(?:RETURNING\b[\s\S]*)?$", Ci);
    private static readonly Regex UnnestSource = new(
        @"^\s*unnest\s*\(\s*(?:@\w+\s*,\s*)*@\w+\s*\)(?:\s+WITH\s+ORDINALITY)?(?:\s+(?:AS\s+)?\w+(?:\s*\(\s*\w+(?:\s*,\s*\w+)*\s*\))?)?" +
        @"(?:\s+ORDER\s+BY\s+[\w.]+(?:\s*,\s*[\w.]+)*)?\s*$", Ci);
    private static readonly Regex WhereEnd = new(@"\b(?:ORDER\s+BY|GROUP\s+BY|HAVING|WINDOW|LIMIT|OFFSET|FETCH|FOR|RETURNING)\b", Ci);

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
            // \uXXXX, \UXXXXXXXX and \x with one to four hex digits; the compiler has already rejected malformed escapes.
            var digits = next switch { 'u' => 4, 'U' => 8, 'x' => HexRun(body, i + 1, 4), _ => 0 };
            if (digits > 0 && i + digits < body.Length && HexRun(body, i + 1, digits) == digits)
            {
                text.Append(char.ConvertFromUtf32(Convert.ToInt32(body.Substring(i + 1, digits), 16)));
                i += digits;
                continue;
            }
            text.Append(next switch
            {
                'n' => '\n', 'r' => '\r', 't' => '\t', '0' => '\0', 'a' => '\a', 'b' => '\b', 'f' => '\f', 'v' => '\v', 'e' => '\u001b',
                _ => next,
            });
        }
        return text.ToString();
    }

    private static int HexRun(string text, int start, int max)
    {
        var count = 0;
        while (count < max && start + count < text.Length && Uri.IsHexDigit(text[start + count])) count++;
        return count;
    }

    /// <summary>True when the text is a SQL statement (after leading comments, whitespace and parentheses).</summary>
    public static bool IsSql(string text)
    {
        var start = text[LeadingNoise(text)..];
        if (CoreStarter.IsMatch(start) || OtherStarter.IsMatch(start)) return true;
        var keyword = AnyCaseStarter.Match(start);
        return keyword.Success && StatementGrammar[keyword.Value].IsMatch(start[keyword.Length..]);
    }

    // The length of the leading whitespace, parentheses, line comments and (nested) block comments.
    private static int LeadingNoise(string text)
    {
        var i = 0;
        while (i < text.Length)
        {
            if (char.IsWhiteSpace(text[i]) || text[i] == '(') i++;
            else if (At(text, i, "--")) { while (i < text.Length && text[i] != '\n') i++; }
            else if (At(text, i, "/*"))
            {
                // PostgreSQL block comments nest; an unterminated one runs to the end.
                for (var depth = 0; i < text.Length;)
                {
                    if (At(text, i, "/*")) { depth++; i += 2; }
                    else if (At(text, i, "*/")) { i += 2; if (--depth == 0) break; }
                    else i++;
                }
            }
            else break;
        }
        return i;
    }

    /// <summary>True when the text is SQL and at least one of its statements is outside the owner-safe subset.</summary>
    public static bool RequiresReview(string text) =>
        IsSql(text) && (Normalize(text) is not { } sql ||
                        sql.Split(';').Any(s => !string.IsNullOrWhiteSpace(s) && !OwnerScoped(s.Trim())));

    private static bool OwnerScoped(string statement)
    {
        if (Flatten(statement) is not { } flat || Unsupported.IsMatch(statement)) return false;
        // A {hole} in SQL that also binds @parameters is spliced text, not a parameter.
        if (statement.Contains('@') && statement.Contains('{')) return false;
        if (Regex.IsMatch(statement, @"^INSERT\b", Ci)) return InsertsOwner(statement);
        return Regex.IsMatch(statement, @"^(?:SELECT|UPDATE|DELETE)\b", Ci) && Filtered(statement, flat);
    }

    // A single-table SELECT/UPDATE/DELETE whose top-level WHERE has an exact owner-equality conjunct.
    private static bool Filtered(string statement, string flat)
    {
        var where = Regex.Match(flat, @"\bWHERE\b", Ci);
        if (!where.Success) return false;
        var head = flat[..where.Index];
        string target;
        if (Regex.IsMatch(head, @"^SELECT\b", Ci))
        {
            var from = Regex.Match(head, @"\bFROM\b", Ci);
            if (!from.Success) return false;
            target = head[(from.Index + from.Length)..];
        }
        else
        {
            var update = Regex.Match(head, @"^UPDATE\s+(?:ONLY\s+)?(?<t>[\s\S]*?)\s+SET\b(?<set>[\s\S]*)$", Ci);
            var delete = Regex.Match(head, @"^DELETE\s+FROM\s+(?:ONLY\s+)?(?<t>[\s\S]*)$", Ci);
            if (update.Success && Regex.IsMatch(update.Groups["set"].Value, @"\bFROM\b", Ci)) return false;
            var set = update.Groups["set"];
            if (update.Success && OwnerMention.IsMatch(statement.Substring(set.Index, set.Length))) return false;
            target = update.Success ? update.Groups["t"].Value : delete.Success ? delete.Groups["t"].Value : "";
        }
        if (!SingleTable.IsMatch(target)) return false;
        var start = where.Index + where.Length;
        var end = WhereEnd.Match(flat, start);
        return Conjuncts(statement[start..(end.Success ? end.Index : flat.Length)]).Any(c => OwnerEquality.IsMatch(c));
    }

    // The top-level AND operands of a condition, with fully parenthesised AND groups expanded.
    private static IEnumerable<string> Conjuncts(string condition)
    {
        if (Flatten(condition) is not { } flat) yield break;
        var start = 0;
        foreach (var end in Regex.Matches(flat, @"\bAND\b", Ci).Select(m => m.Index).Append(flat.Length))
        {
            var part = condition[start..end].Trim();
            start = Math.Min(end + 3, flat.Length);
            if (part.StartsWith('(') && Closing(part, 0) == part.Length - 1)
                foreach (var inner in Conjuncts(part[1..^1])) yield return inner;
            else yield return part;
        }
    }

    // An INSERT writes its own owner when the value at the owner column's position is the owner parameter.
    private static bool InsertsOwner(string statement)
    {
        var head = InsertHead.Match(statement);
        if (!head.Success) return false;
        var columns = Items(statement, head.Length - 1, out var after);
        var owner = columns.FindIndex(c => OwnerColumnOnly.IsMatch(c));
        var rest = statement[after..];
        List<string> row;
        string tail;
        var values = Regex.Match(rest, @"^\s*VALUES\s*\(", Ci);
        if (values.Success)
        {
            row = Items(rest, values.Length - 1, out var rowEnd);
            tail = rest[rowEnd..];
            if (tail.TrimStart().StartsWith(',')) return false; // multi-row VALUES
        }
        else if (Regex.IsMatch(rest, @"^\s*SELECT\b", Ci) && Flatten(rest) is { } flat)
        {
            var split = Regex.Match(flat, @"\b(?:ON\s+CONFLICT|RETURNING)\b", Ci);
            var query = rest[..(split.Success ? split.Index : rest.Length)].Trim();
            tail = split.Success ? rest[split.Index..] : "";
            var from = Regex.Match(Flatten(query)!, @"\bFROM\b", Ci);
            if (from.Success && !UnnestSource.IsMatch(query[(from.Index + from.Length)..]) && !Filtered(query, Flatten(query)!))
                return false;
            var list = query[6..(from.Success ? from.Index : query.Length)];
            row = Split(list);
        }
        else return false;
        if (owner < 0 || owner >= row.Count || !OwnerValueOnly.IsMatch(row[owner])) return false;
        var conflict = InsertTail.Match(tail);
        if (!conflict.Success) return false;
        if (!conflict.Groups["update"].Success) return true;
        var assignments = conflict.Groups["update"].Value;
        var condition = Flatten(assignments) is { } flatAssignments ? Regex.Match(flatAssignments, @"\bWHERE\b", Ci) : null;
        if (condition is null || OwnerMention.IsMatch(condition.Success ? assignments[..condition.Index] : assignments)) return false;
        return conflict.Groups["target"].Value.Split(',').Any(c => OwnerColumnOnly.IsMatch(c.Trim()));
    }

    // Removes comments, quoted strings and quoted identifiers (keeping owner columns) so that only SQL structure remains;
    // null when the text cannot be tokenised (an unterminated quote or comment, or a hole inside an identifier).
    private static string? Normalize(string text)
    {
        var sql = new StringBuilder(text.Length);
        for (var i = 0; i < text.Length;)
        {
            if (At(text, i, "--"))
            {
                while (i < text.Length && text[i] != '\n') i++;
                sql.Append(' ');
            }
            else if (At(text, i, "/*"))
            {
                // PostgreSQL block comments nest.
                for (var depth = 0; ;)
                {
                    if (i >= text.Length) return null;
                    if (At(text, i, "/*")) { depth++; i += 2; }
                    else if (At(text, i, "*/")) { i += 2; if (--depth == 0) break; }
                    else i++;
                }
                sql.Append(' ');
            }
            else if (text[i] == '\'')
            {
                var escapes = i > 0 && text[i - 1] is 'E' or 'e' && (i == 1 || !IsWord(text[i - 2]));
                for (i++; ; i++)
                {
                    if (i >= text.Length) return null;
                    if (escapes && text[i] == '\\') i++;
                    else if (At(text, i, "''")) i++;
                    else if (text[i] == '\'') { i++; break; }
                }
                sql.Append("''");
            }
            else if (text[i] == '$' && (i == 0 || !IsWord(text[i - 1])) &&
                     Regex.Match(text[i..], @"^\$(?:[A-Za-z_]\w*)?\$") is { Success: true } tag)
            {
                var close = text.IndexOf(tag.Value, i + tag.Length, StringComparison.Ordinal);
                if (close < 0) return null;
                i = close + tag.Length;
                sql.Append("''");
            }
            else if (text[i] == '"')
            {
                var name = new StringBuilder();
                for (i++; ; i++)
                {
                    if (i >= text.Length) return null;
                    if (At(text, i, "\"\"")) { name.Append('"'); i++; }
                    else if (text[i] == '"') { i++; break; }
                    else name.Append(text[i]);
                }
                if (name.ToString().Contains('{')) return null;
                // Other owner-like names stay recognisable to OwnerMention without counting as the owner column.
                sql.Append(name.ToString() switch
                {
                    "OwnerId" => "\"OwnerId\"",
                    var n when OwnerMention.IsMatch(n) => "\"OWNER_ID\"",
                    _ => "\"_\"",
                });
            }
            else sql.Append(text[i++]);
        }
        return sql.ToString();
    }

    // The text with everything inside parentheses and braces blanked, so regexes only see the top level; null when unbalanced.
    private static string? Flatten(string text)
    {
        var flat = new StringBuilder(text.Length);
        var depth = 0;
        foreach (var c in text)
        {
            if (c is ')' or '}' && --depth < 0) return null;
            flat.Append(depth > 0 ? ' ' : c);
            if (c is '(' or '{') depth++;
        }
        return depth == 0 ? flat.ToString() : null;
    }

    private static int Closing(string text, int open) =>
        Flatten(text[open..]) is { } flat ? open + flat.IndexOf(text[open] == '(' ? ')' : '}', 1) : -1;

    // The comma-separated items inside the parentheses that open at the given index.
    private static List<string> Items(string text, int open, out int end)
    {
        var close = Closing(text, open);
        if (close < 0) { end = text.Length; return []; }
        end = close + 1;
        return Split(text[(open + 1)..close]);
    }

    private static List<string> Split(string list)
    {
        var flat = Flatten(list);
        if (flat is null) return [];
        var items = new List<string>();
        var start = 0;
        for (var i = 0; i <= flat.Length; i++)
            if (i == flat.Length || flat[i] == ',') { items.Add(list[start..i].Trim()); start = i + 1; }
        return items;
    }

    private static bool At(string text, int index, string token) => string.CompareOrdinal(text, index, token, 0, token.Length) == 0;

    private static bool IsWord(char c) => char.IsLetterOrDigit(c) || c == '_';
}
