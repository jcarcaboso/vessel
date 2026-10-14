namespace Vessel.Domain.Common;

/// <summary>A value the owner supplied breaks an entity rule. The API answers 400 with this message.</summary>
public sealed class DomainValidationException(string message) : ArgumentException(message);

/// <summary>A lifecycle rule the request broke, as opposed to malformed input. The API answers 409 with this message.</summary>
public sealed class DomainRuleException(string message) : Exception(message);
