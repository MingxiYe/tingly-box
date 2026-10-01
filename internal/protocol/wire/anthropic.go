package wire

// AnthropicMsgWire is the intermediate JSON representation used to build
// anthropic.Message / anthropic.BetaMessage via marshal+unmarshal, which is
// necessary because the SDK content union types have no public constructors.
//
// The resulting RawJSON is what clients receive, so every key the SDK marks
// required is emitted. Container, Diagnostics and StopDetails are always null:
// a converted response never used a container, carries no request diagnostics
// and has no refusal detail. Beta-only keys (context_management,
// input_transformations) are left out because the same JSON also serves v1.
type AnthropicMsgWire struct {
	ID           string             `json:"id"`
	Type         string             `json:"type"`
	Role         string             `json:"role"`
	Content      interface{}        `json:"content"`
	Model        string             `json:"model"`
	StopReason   string             `json:"stop_reason"`
	StopSequence *string            `json:"stop_sequence"` // null unless a custom stop sequence matched
	Usage        AnthropicUsageWire `json:"usage"`
	Container    interface{}        `json:"container"`
	Diagnostics  interface{}        `json:"diagnostics"`
	StopDetails  interface{}        `json:"stop_details"`
}

// AnthropicUsageWire represents the Anthropic usage wire format.
// input_tokens = uncached only; cache_read and cache_creation are separate.
//
// CacheCreation, InferenceGeo, ServerToolUse and ServiceTier are always null:
// OpenAI-side usage has no TTL breakdown, region, server-tool counts or
// Anthropic tier to translate. Beta-only keys (fallback_credit, iterations,
// speed) are left out for the same reason as on AnthropicMsgWire.
type AnthropicUsageWire struct {
	InputTokens              int64                             `json:"input_tokens"`
	OutputTokens             int64                             `json:"output_tokens"`
	CacheReadInputTokens     int64                             `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int64                             `json:"cache_creation_input_tokens"`
	OutputTokensDetails      *AnthropicOutputTokensDetailsWire `json:"output_tokens_details"` // null when no thinking tokens were reported
	CacheCreation            interface{}                       `json:"cache_creation"`
	InferenceGeo             interface{}                       `json:"inference_geo"`
	ServerToolUse            interface{}                       `json:"server_tool_use"`
	ServiceTier              interface{}                       `json:"service_tier"`
}

// AnthropicOutputTokensDetailsWire mirrors Anthropic's own
// usage.output_tokens_details: thinking_tokens is a subset of output_tokens,
// same relationship as OpenAI's completion_tokens_details.reasoning_tokens.
type AnthropicOutputTokensDetailsWire struct {
	ThinkingTokens int64 `json:"thinking_tokens"`
}
