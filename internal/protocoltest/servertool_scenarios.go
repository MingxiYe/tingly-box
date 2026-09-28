package protocoltest

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"sync"

	"github.com/tingly-dev/tingly-box/internal/protocolserver/servertool"
	coretool "github.com/tingly-dev/tingly-box/internal/tool"
)

// Server-owned tool fixtures for MCP / tool-loop coverage. The gateway injects
// the echo tool (registered through NewTestEnvOptionWithServertoolProviders)
// into upstream requests; the mock upstream "calls" it in the first round and
// answers with final text once the request carries the tool's result.

const (
	OwnedToolScenarioName = "mcp_owned_tool"
	// OwnedToolWireName is the name under which the gateway exposes the
	// in-process echo tool to the model.
	OwnedToolWireName = "tingly_box_mcp__builtin__echo"
	// OwnedToolFinalText is the model's answer after the tool round.
	OwnedToolFinalText  = "owned-tool-final"
	ownedToolResultText = "echo-result"
	ownedToolErrorText  = "echo-failed"
)

// EchoServertoolProvider is an in-process server tool that records every
// execution so tests can assert the tool ran exactly once with the model's
// arguments.
type EchoServertoolProvider struct {
	// Fail makes every execution return an error instead of a result.
	Fail bool

	mu    sync.Mutex
	calls []map[string]any
}

func NewEchoServertoolProvider() *EchoServertoolProvider { return &EchoServertoolProvider{} }

// Calls returns the arguments of each execution, in order.
func (p *EchoServertoolProvider) Calls() []map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]map[string]any(nil), p.calls...)
}

func (p *EchoServertoolProvider) Descriptor() coretool.VirtualTool {
	return coretool.VirtualTool{
		Name:        "echo",
		Description: "Echo a value for protocol harness validation",
		InputSchema: map[string]any{
			"type":       "object",
			"properties": map[string]any{"q": map[string]any{"type": "string"}},
			"required":   []string{"q"},
		},
		Handler: func(_ context.Context, call coretool.ToolCall) (coretool.ToolResult, error) {
			p.mu.Lock()
			p.calls = append(p.calls, call.Arguments)
			p.mu.Unlock()
			if p.Fail {
				return coretool.ToolResult{}, errors.New(ownedToolErrorText)
			}
			return coretool.TextToolResult(ownedToolResultText), nil
		},
	}
}

func (p *EchoServertoolProvider) Hook() servertool.Hook { return nil }

var _ servertool.ToolProvider = (*EchoServertoolProvider)(nil)

// ownedToolCallIDs are the call ids the owned-tool fixtures use per format.
var ownedToolCallIDs = [][]byte{[]byte("toolu-owned-tool"), []byte("call-owned-tool")}

// callsOwnedTool reports whether the mock model should call the echo tool:
// like a real model it only does so when the gateway offered the tool, and
// only until the request carries that call (i.e. the continuation round,
// whatever the tool returned — result or error).
func callsOwnedTool(request []byte) bool {
	if !bytes.Contains(request, []byte(OwnedToolWireName)) {
		return false
	}
	for _, id := range ownedToolCallIDs {
		if bytes.Contains(request, id) {
			return false
		}
	}
	return true
}

// OwnedToolScenario: when the gateway offers the echo tool, round 1 calls it
// and round 2 (request carries its result) returns OwnedToolFinalText; when
// the tool is not offered the model answers directly.
func OwnedToolScenario() Scenario {
	nonStream := func(first, final any) func([]byte) (int, []byte) {
		return func(request []byte) (int, []byte) {
			if callsOwnedTool(request) {
				return http.StatusOK, mustMarshal(first)
			}
			return http.StatusOK, mustMarshal(final)
		}
	}
	stream := func(first, final []string) func([]byte) []string {
		return func(request []byte) []string {
			if callsOwnedTool(request) {
				return first
			}
			return final
		}
	}
	return Scenario{
		Name:        OwnedToolScenarioName,
		Description: "Gateway executes a server-owned tool and returns the provider's second-round answer",
		Tags:        []string{"mcp", "servertool"},
		MockResponses: map[ResponseFormat]MockResponseBuilder{
			FormatAnthropic: {
				NonStreamFor: nonStream(matrixAnthropicOwnedTool(), matrixAnthropicOwnedToolFinal()),
				StreamFor:    stream(matrixAnthropicOwnedToolStream(), matrixAnthropicOwnedToolFinalStream()),
			},
			FormatOpenAIChat: {
				NonStreamFor: nonStream(matrixChatOwnedTool(), matrixChatOwnedToolFinal()),
				StreamFor:    stream(matrixChatOwnedToolStream(), matrixChatOwnedToolFinalStream()),
			},
			FormatOpenAIResponses: {
				NonStreamFor: nonStream(matrixResponsesOwnedTool(), matrixResponsesOwnedToolFinal()),
				StreamFor:    stream(matrixResponsesOwnedToolStream(), matrixResponsesOwnedToolFinalStream()),
			},
		},
		Assertions: []Assertion{
			AssertHTTPStatus(http.StatusOK),
			AssertContentEquals(OwnedToolFinalText),
		},
	}
}

func matrixAnthropicOwnedTool() map[string]any {
	return map[string]any{
		"id": "msg-owned-tool", "type": "message", "role": "assistant", "model": "worker-model",
		"content":     []map[string]any{{"type": "tool_use", "id": "toolu-owned-tool", "name": OwnedToolWireName, "input": map[string]any{"q": "x"}}},
		"stop_reason": "tool_use",
		"usage":       map[string]any{"input_tokens": 8, "output_tokens": 3},
	}
}

func matrixAnthropicOwnedToolFinal() map[string]any {
	return map[string]any{
		"id": "msg-owned-tool-final", "type": "message", "role": "assistant", "model": "worker-model",
		"content":     []map[string]any{{"type": "text", "text": "owned-tool-final"}},
		"stop_reason": "end_turn",
		"usage":       map[string]any{"input_tokens": 12, "output_tokens": 5},
	}
}

func matrixAnthropicOwnedToolStream() []string {
	return []string{
		`event: message_start`,
		`data: {"type":"message_start","message":{"id":"msg-owned-tool","type":"message","role":"assistant","model":"worker-model","content":[],"stop_reason":null,"usage":{"input_tokens":8,"output_tokens":0}}}`,
		`event: content_block_start`,
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu-owned-tool","name":"tingly_box_mcp__builtin__echo","input":{}}}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"q\":\"x\"}"}}`,
		`event: content_block_stop`,
		`data: {"type":"content_block_stop","index":0}`,
		`event: message_delta`,
		`data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":3}}`,
		`event: message_stop`,
		`data: {"type":"message_stop"}`,
	}
}

func matrixAnthropicOwnedToolFinalStream() []string {
	return []string{
		`event: message_start`,
		`data: {"type":"message_start","message":{"id":"msg-owned-tool-final","type":"message","role":"assistant","model":"worker-model","content":[],"stop_reason":null,"usage":{"input_tokens":12,"output_tokens":0}}}`,
		`event: content_block_start`,
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"owned-tool-final"}}`,
		`event: content_block_stop`,
		`data: {"type":"content_block_stop","index":0}`,
		`event: message_delta`,
		`data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}`,
		`event: message_stop`,
		`data: {"type":"message_stop"}`,
	}
}

func matrixChatOwnedTool() map[string]any {
	return map[string]any{
		"id": "chatcmpl-owned-tool", "object": "chat.completion", "created": 1, "model": "worker-model",
		"choices": []map[string]any{{
			"index": 0,
			"message": map[string]any{"role": "assistant", "content": "", "tool_calls": []map[string]any{{
				"id": "call-owned-tool", "type": "function", "function": map[string]any{"name": OwnedToolWireName, "arguments": `{"q":"x"}`},
			}}},
			"finish_reason": "tool_calls",
		}},
		"usage": map[string]any{"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11},
	}
}

func matrixChatOwnedToolFinal() map[string]any {
	return map[string]any{
		"id": "chatcmpl-owned-tool-final", "object": "chat.completion", "created": 2, "model": "worker-model",
		"choices": []map[string]any{{
			"index": 0, "message": map[string]any{"role": "assistant", "content": "owned-tool-final"}, "finish_reason": "stop",
		}},
		"usage": map[string]any{"prompt_tokens": 12, "completion_tokens": 5, "total_tokens": 17},
	}
}

func matrixChatOwnedToolStream() []string {
	return []string{
		`data: {"id":"chatcmpl-owned-tool","object":"chat.completion.chunk","created":1,"model":"worker-model","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call-owned-tool","type":"function","function":{"name":"tingly_box_mcp__builtin__echo","arguments":"{\"q\":\"x\"}"}}]},"finish_reason":null}]}`,
		`data: {"id":"chatcmpl-owned-tool","object":"chat.completion.chunk","created":1,"model":"worker-model","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
		`data: [DONE]`,
	}
}

func matrixChatOwnedToolFinalStream() []string {
	return []string{
		`data: {"id":"chatcmpl-owned-tool-final","object":"chat.completion.chunk","created":2,"model":"worker-model","choices":[{"index":0,"delta":{"role":"assistant","content":"owned-tool-final"},"finish_reason":null}]}`,
		`data: {"id":"chatcmpl-owned-tool-final","object":"chat.completion.chunk","created":2,"model":"worker-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
		`data: [DONE]`,
	}
}

func matrixResponsesOwnedTool() map[string]any {
	return map[string]any{
		"id": "resp-owned-tool", "object": "response", "created_at": 1, "model": "worker-model", "status": "completed",
		"output": []map[string]any{{
			"id": "fc-owned-tool", "type": "function_call", "call_id": "call-owned-tool", "name": OwnedToolWireName, "arguments": `{"q":"x"}`, "status": "completed",
		}},
		"usage": map[string]any{"input_tokens": 8, "output_tokens": 3, "total_tokens": 11},
	}
}

func matrixResponsesOwnedToolFinal() map[string]any {
	return map[string]any{
		"id": "resp-owned-tool-final", "object": "response", "created_at": 2, "model": "worker-model", "status": "completed",
		"output": []map[string]any{{
			"id": "item-owned-tool-final", "type": "message", "role": "assistant", "status": "completed",
			"content": []map[string]any{{"type": "output_text", "text": "owned-tool-final", "annotations": []any{}}},
		}},
		"usage": map[string]any{"input_tokens": 12, "output_tokens": 5, "total_tokens": 17},
	}
}

func matrixResponsesOwnedToolStream() []string {
	return []string{
		`data: {"type":"response.created","response":{"id":"resp-owned-tool","object":"response","created_at":1,"model":"worker-model","status":"in_progress","output":[]}}`,
		`data: {"type":"response.output_item.added","response_id":"resp-owned-tool","output_index":0,"item":{"id":"fc-owned-tool","type":"function_call","call_id":"call-owned-tool","name":"tingly_box_mcp__builtin__echo","status":"in_progress"}}`,
		`data: {"type":"response.function_call_arguments.delta","response_id":"resp-owned-tool","item_id":"fc-owned-tool","output_index":0,"delta":"{\"q\":\"x\"}"}`,
		`data: {"type":"response.function_call_arguments.done","response_id":"resp-owned-tool","item_id":"fc-owned-tool","output_index":0,"arguments":"{\"q\":\"x\"}"}`,
		`data: {"type":"response.completed","response":{"id":"resp-owned-tool","object":"response","created_at":1,"model":"worker-model","status":"completed","output":[{"id":"fc-owned-tool","type":"function_call","call_id":"call-owned-tool","name":"tingly_box_mcp__builtin__echo","arguments":"{\"q\":\"x\"}","status":"completed"}],"usage":{"input_tokens":8,"output_tokens":3,"total_tokens":11}}}`,
		`data: [DONE]`,
	}
}

func matrixResponsesOwnedToolFinalStream() []string {
	return []string{
		`data: {"type":"response.created","response":{"id":"resp-owned-tool-final","object":"response","created_at":2,"model":"worker-model","status":"in_progress","output":[]}}`,
		`data: {"type":"response.output_item.added","response_id":"resp-owned-tool-final","output_index":0,"item":{"id":"item-owned-tool-final","type":"message","role":"assistant","status":"in_progress","content":[]}}`,
		`data: {"type":"response.output_text.delta","response_id":"resp-owned-tool-final","item_id":"item-owned-tool-final","output_index":0,"content_index":0,"delta":"owned-tool-final"}`,
		`data: {"type":"response.output_text.done","response_id":"resp-owned-tool-final","item_id":"item-owned-tool-final","output_index":0,"content_index":0,"text":"owned-tool-final"}`,
		`data: {"type":"response.completed","response":{"id":"resp-owned-tool-final","object":"response","created_at":2,"model":"worker-model","status":"completed","output":[{"id":"item-owned-tool-final","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"owned-tool-final","annotations":[]}]}],"usage":{"input_tokens":12,"output_tokens":5,"total_tokens":17}}}`,
		`data: [DONE]`,
	}
}

const (
	OwnedThenClientToolScenarioName = "mcp_owned_then_client_tool"
	clientToolName                  = "get_weather"
)

// OwnedThenClientToolScenario: round 1 calls the owned echo tool; once its
// result is in the request, round 2 calls the client tool get_weather.
func OwnedThenClientToolScenario() Scenario {
	anthropicClientTool := map[string]any{
		"id": "msg-client-tool", "type": "message", "role": "assistant", "model": "worker-model",
		"content":     []map[string]any{{"type": "tool_use", "id": "toolu-client-tool", "name": clientToolName, "input": map[string]any{"location": "Paris"}}},
		"stop_reason": "tool_use",
		"usage":       map[string]any{"input_tokens": 12, "output_tokens": 5},
	}
	anthropicClientToolStream := []string{
		`event: message_start`,
		`data: {"type":"message_start","message":{"id":"msg-client-tool","type":"message","role":"assistant","model":"worker-model","content":[],"stop_reason":null,"usage":{"input_tokens":12,"output_tokens":0}}}`,
		`event: content_block_start`,
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu-client-tool","name":"get_weather","input":{}}}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"location\":\"Paris\"}"}}`,
		`event: content_block_stop`,
		`data: {"type":"content_block_stop","index":0}`,
		`event: message_delta`,
		`data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":5}}`,
		`event: message_stop`,
		`data: {"type":"message_stop"}`,
	}
	chatClientTool := map[string]any{
		"id": "chatcmpl-client-tool", "object": "chat.completion", "created": 2, "model": "worker-model",
		"choices": []map[string]any{{
			"index": 0,
			"message": map[string]any{"role": "assistant", "content": "", "tool_calls": []map[string]any{{
				"id": "call-client-tool", "type": "function", "function": map[string]any{"name": clientToolName, "arguments": `{"location":"Paris"}`},
			}}},
			"finish_reason": "tool_calls",
		}},
		"usage": map[string]any{"prompt_tokens": 12, "completion_tokens": 5, "total_tokens": 17},
	}
	chatClientToolStream := []string{
		`data: {"id":"chatcmpl-client-tool","object":"chat.completion.chunk","created":2,"model":"worker-model","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call-client-tool","type":"function","function":{"name":"get_weather","arguments":"{\"location\":\"Paris\"}"}}]},"finish_reason":null}]}`,
		`data: {"id":"chatcmpl-client-tool","object":"chat.completion.chunk","created":2,"model":"worker-model","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
		`data: [DONE]`,
	}

	nonStream := func(first, second any) func([]byte) (int, []byte) {
		return func(request []byte) (int, []byte) {
			if callsOwnedTool(request) {
				return http.StatusOK, mustMarshal(first)
			}
			return http.StatusOK, mustMarshal(second)
		}
	}
	stream := func(first, second []string) func([]byte) []string {
		return func(request []byte) []string {
			if callsOwnedTool(request) {
				return first
			}
			return second
		}
	}
	return Scenario{
		Name:        OwnedThenClientToolScenarioName,
		Description: "Server tool round followed by a client tool call",
		Tags:        []string{"mcp", "servertool", "guardrails"},
		MockResponses: map[ResponseFormat]MockResponseBuilder{
			FormatAnthropic: {
				NonStreamFor: nonStream(matrixAnthropicOwnedTool(), anthropicClientTool),
				StreamFor:    stream(matrixAnthropicOwnedToolStream(), anthropicClientToolStream),
			},
			FormatOpenAIChat: {
				NonStreamFor: nonStream(matrixChatOwnedTool(), chatClientTool),
				StreamFor:    stream(matrixChatOwnedToolStream(), chatClientToolStream),
			},
		},
	}
}

// AlwaysOwnedToolScenario: the model calls the owned echo tool in every round
// it is offered, whatever came back — the gateway must stop at its round limit.
func AlwaysOwnedToolScenario() Scenario {
	always := func(tool, final any) func([]byte) (int, []byte) {
		return func(request []byte) (int, []byte) {
			if bytes.Contains(request, []byte(OwnedToolWireName)) {
				return http.StatusOK, mustMarshal(tool)
			}
			return http.StatusOK, mustMarshal(final)
		}
	}
	alwaysStream := func(tool, final []string) func([]byte) []string {
		return func(request []byte) []string {
			if bytes.Contains(request, []byte(OwnedToolWireName)) {
				return tool
			}
			return final
		}
	}
	return Scenario{
		Name:        "mcp_always_owned_tool",
		Description: "Model keeps calling the server tool; the loop must be bounded",
		Tags:        []string{"mcp", "servertool"},
		MockResponses: map[ResponseFormat]MockResponseBuilder{
			FormatAnthropic: {
				NonStreamFor: always(matrixAnthropicOwnedTool(), matrixAnthropicOwnedToolFinal()),
				StreamFor:    alwaysStream(matrixAnthropicOwnedToolStream(), matrixAnthropicOwnedToolFinalStream()),
			},
			FormatOpenAIChat: {
				NonStreamFor: always(matrixChatOwnedTool(), matrixChatOwnedToolFinal()),
				StreamFor:    alwaysStream(matrixChatOwnedToolStream(), matrixChatOwnedToolFinalStream()),
			},
		},
	}
}

const clientToolResultText = "weather-result"

// MixedToolScenario: the first round calls the owned echo tool and the client
// tool get_weather together. Once the request carries the client tool's
// result, the model answers with OwnedToolFinalText.
func MixedToolScenario() Scenario {
	anthropicMixed := map[string]any{
		"id": "msg-mixed", "type": "message", "role": "assistant", "model": "worker-model",
		"content": []map[string]any{
			{"type": "tool_use", "id": "toolu-owned-tool", "name": OwnedToolWireName, "input": map[string]any{"q": "x"}},
			{"type": "tool_use", "id": "toolu-client-tool", "name": clientToolName, "input": map[string]any{"location": "Paris"}},
		},
		"stop_reason": "tool_use",
		"usage":       map[string]any{"input_tokens": 8, "output_tokens": 6},
	}
	anthropicMixedStream := []string{
		`event: message_start`,
		`data: {"type":"message_start","message":{"id":"msg-mixed","type":"message","role":"assistant","model":"worker-model","content":[],"stop_reason":null,"usage":{"input_tokens":8,"output_tokens":0}}}`,
		`event: content_block_start`,
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu-owned-tool","name":"` + OwnedToolWireName + `","input":{}}}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"q\":\"x\"}"}}`,
		`event: content_block_stop`,
		`data: {"type":"content_block_stop","index":0}`,
		`event: content_block_start`,
		`data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu-client-tool","name":"get_weather","input":{}}}`,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"location\":\"Paris\"}"}}`,
		`event: content_block_stop`,
		`data: {"type":"content_block_stop","index":1}`,
		`event: message_delta`,
		`data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":6}}`,
		`event: message_stop`,
		`data: {"type":"message_stop"}`,
	}
	chatMixed := map[string]any{
		"id": "chatcmpl-mixed", "object": "chat.completion", "created": 1, "model": "worker-model",
		"choices": []map[string]any{{
			"index": 0,
			"message": map[string]any{"role": "assistant", "content": "", "tool_calls": []map[string]any{
				{"id": "call-owned-tool", "type": "function", "function": map[string]any{"name": OwnedToolWireName, "arguments": `{"q":"x"}`}},
				{"id": "call-client-tool", "type": "function", "function": map[string]any{"name": clientToolName, "arguments": `{"location":"Paris"}`}},
			}},
			"finish_reason": "tool_calls",
		}},
		"usage": map[string]any{"prompt_tokens": 8, "completion_tokens": 6, "total_tokens": 14},
	}
	chatMixedStream := []string{
		// One chunk per tool call, as OpenAI streams parallel calls.
		`data: {"id":"chatcmpl-mixed","object":"chat.completion.chunk","created":1,"model":"worker-model","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call-owned-tool","type":"function","function":{"name":"` + OwnedToolWireName + `","arguments":"{\"q\":\"x\"}"}}]},"finish_reason":null}]}`,
		`data: {"id":"chatcmpl-mixed","object":"chat.completion.chunk","created":1,"model":"worker-model","choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call-client-tool","type":"function","function":{"name":"get_weather","arguments":"{\"location\":\"Paris\"}"}}]},"finish_reason":null}]}`,
		`data: {"id":"chatcmpl-mixed","object":"chat.completion.chunk","created":1,"model":"worker-model","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
		`data: [DONE]`,
	}

	final := func(request []byte) bool { return bytes.Contains(request, []byte(clientToolResultText)) }
	nonStream := func(mixed, done any) func([]byte) (int, []byte) {
		return func(request []byte) (int, []byte) {
			if final(request) {
				return http.StatusOK, mustMarshal(done)
			}
			return http.StatusOK, mustMarshal(mixed)
		}
	}
	stream := func(mixed, done []string) func([]byte) []string {
		return func(request []byte) []string {
			if final(request) {
				return done
			}
			return mixed
		}
	}
	return Scenario{
		Name:        "mcp_mixed_tools",
		Description: "One round calls a server tool and a client tool together",
		Tags:        []string{"mcp", "servertool"},
		MockResponses: map[ResponseFormat]MockResponseBuilder{
			FormatAnthropic: {
				NonStreamFor: nonStream(anthropicMixed, matrixAnthropicOwnedToolFinal()),
				StreamFor:    stream(anthropicMixedStream, matrixAnthropicOwnedToolFinalStream()),
			},
			FormatOpenAIChat: {
				NonStreamFor: nonStream(chatMixed, matrixChatOwnedToolFinal()),
				StreamFor:    stream(chatMixedStream, matrixChatOwnedToolFinalStream()),
			},
		},
	}
}

// ─── Tool-round edge fixtures ────────────────────────────────────────────────

// sseData renders one SSE data line from v; sseEvent renders an Anthropic
// event/data pair.
func sseData(v any) string { return "data: " + string(mustMarshal(v)) }

func sseEvent(event string, v any) []string {
	return []string{"event: " + event, sseData(v)}
}

// anthropicToolUseStart returns the message_start and content_block_start
// events that open an Anthropic tool_use block; input is what the start block
// carries (the Anthropic API sends {} and streams the input as deltas).
func anthropicToolUseStart(msgID, toolID, name string, input map[string]any) []string {
	var lines []string
	lines = append(lines, sseEvent("message_start", map[string]any{"type": "message_start", "message": map[string]any{
		"id": msgID, "type": "message", "role": "assistant", "model": "worker-model", "content": []any{},
		"stop_reason": nil, "usage": map[string]any{"input_tokens": 8, "output_tokens": 0},
	}})...)
	lines = append(lines, sseEvent("content_block_start", map[string]any{"type": "content_block_start", "index": 0,
		"content_block": map[string]any{"type": "tool_use", "id": toolID, "name": name, "input": input}})...)
	return lines
}

// anthropicToolUseEnd closes the single tool_use block and the message.
func anthropicToolUseEnd() []string {
	var lines []string
	lines = append(lines, sseEvent("content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})...)
	lines = append(lines, sseEvent("message_delta", map[string]any{"type": "message_delta",
		"delta": map[string]any{"stop_reason": "tool_use", "stop_sequence": nil}, "usage": map[string]any{"output_tokens": 3}})...)
	lines = append(lines, sseEvent("message_stop", map[string]any{"type": "message_stop"})...)
	return lines
}

// anthropicToolUseStream is a complete Anthropic tool_use stream whose input
// arrives as one input_json_delta.
func anthropicToolUseStream(msgID, toolID, name, inputJSON string) []string {
	lines := anthropicToolUseStart(msgID, toolID, name, map[string]any{})
	lines = append(lines, sseEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0,
		"delta": map[string]any{"type": "input_json_delta", "partial_json": inputJSON}})...)
	return append(lines, anthropicToolUseEnd()...)
}

func anthropicToolUseMessage(msgID, toolID, name string, input map[string]any) map[string]any {
	return map[string]any{
		"id": msgID, "type": "message", "role": "assistant", "model": "worker-model",
		"content":     []map[string]any{{"type": "tool_use", "id": toolID, "name": name, "input": input}},
		"stop_reason": "tool_use",
		"usage":       map[string]any{"input_tokens": 8, "output_tokens": 3},
	}
}

func chatToolCallChunk(chatID, callID, name, args string) string {
	return sseData(map[string]any{"id": chatID, "object": "chat.completion.chunk", "created": 1, "model": "worker-model",
		"choices": []map[string]any{{"index": 0, "finish_reason": nil, "delta": map[string]any{"role": "assistant",
			"tool_calls": []map[string]any{{"index": 0, "id": callID, "type": "function", "function": map[string]any{"name": name, "arguments": args}}}}}}})
}

func chatToolCallStream(chatID, callID, name, args string) []string {
	return []string{
		chatToolCallChunk(chatID, callID, name, args),
		sseData(map[string]any{"id": chatID, "object": "chat.completion.chunk", "created": 1, "model": "worker-model",
			"choices": []map[string]any{{"index": 0, "delta": map[string]any{}, "finish_reason": "tool_calls"}}}),
		`data: [DONE]`,
	}
}

func chatToolCallCompletion(chatID, callID, name, args string) map[string]any {
	return map[string]any{
		"id": chatID, "object": "chat.completion", "created": 1, "model": "worker-model",
		"choices": []map[string]any{{
			"index": 0,
			"message": map[string]any{"role": "assistant", "content": "", "tool_calls": []map[string]any{{
				"id": callID, "type": "function", "function": map[string]any{"name": name, "arguments": args},
			}}},
			"finish_reason": "tool_calls",
		}},
		"usage": map[string]any{"prompt_tokens": 8, "completion_tokens": 3, "total_tokens": 11},
	}
}

func responsesFunctionCallItem(callID, name, args, status string) map[string]any {
	return map[string]any{"id": "fc-" + callID, "type": "function_call", "call_id": callID, "name": name, "arguments": args, "status": status}
}

func responsesFunctionCallStart(respID, callID, name string) []string {
	item := responsesFunctionCallItem(callID, name, "", "in_progress")
	delete(item, "arguments")
	return []string{
		sseData(map[string]any{"type": "response.created", "response": map[string]any{"id": respID, "object": "response", "created_at": 1, "model": "worker-model", "status": "in_progress", "output": []any{}}}),
		sseData(map[string]any{"type": "response.output_item.added", "response_id": respID, "output_index": 0, "item": item}),
	}
}

func responsesArgumentsDelta(respID, callID, delta string) string {
	return sseData(map[string]any{"type": "response.function_call_arguments.delta", "response_id": respID, "item_id": "fc-" + callID, "output_index": 0, "delta": delta})
}

func responsesFunctionCallStream(respID, callID, name, args string) []string {
	lines := responsesFunctionCallStart(respID, callID, name)
	return append(lines,
		responsesArgumentsDelta(respID, callID, args),
		sseData(map[string]any{"type": "response.function_call_arguments.done", "response_id": respID, "item_id": "fc-" + callID, "output_index": 0, "arguments": args}),
		sseData(map[string]any{"type": "response.completed", "response": map[string]any{"id": respID, "object": "response", "created_at": 1, "model": "worker-model", "status": "completed",
			"output": []any{responsesFunctionCallItem(callID, name, args, "completed")},
			"usage":  map[string]any{"input_tokens": 8, "output_tokens": 3, "total_tokens": 11}}}),
		`data: [DONE]`,
	)
}

func responsesFunctionCallResponse(respID, callID, name, args string) map[string]any {
	return map[string]any{
		"id": respID, "object": "response", "created_at": 1, "model": "worker-model", "status": "completed",
		"output": []any{responsesFunctionCallItem(callID, name, args, "completed")},
		"usage":  map[string]any{"input_tokens": 8, "output_tokens": 3, "total_tokens": 11},
	}
}

// ownedToolRoundOr serves the owned-tool fixtures while the gateway offers
// the echo tool and its call is not yet in the conversation, and next
// otherwise — the shape every multi-round fixture below shares.
func ownedToolRoundOr(format ResponseFormat, next MockResponseBuilder) MockResponseBuilder {
	owned := OwnedToolScenario().MockResponses[format]
	b := MockResponseBuilder{}
	if next.NonStreamFor != nil {
		b.NonStreamFor = func(request []byte) (int, []byte) {
			if callsOwnedTool(request) {
				return owned.NonStreamFor(request)
			}
			return next.NonStreamFor(request)
		}
	}
	if next.StreamFor != nil {
		b.StreamFor = func(request []byte) []string {
			if callsOwnedTool(request) {
				return owned.StreamFor(request)
			}
			return next.StreamFor(request)
		}
	}
	return b
}

// TruncatedOwnedToolScenario: when the gateway offers the echo tool, the
// provider's stream is cut inside the tool call — its arguments are half
// sent and no terminal event (message_stop / finish_reason / [DONE] /
// response.completed) follows. Without the tool offered the model answers.
func TruncatedOwnedToolScenario() Scenario {
	const partial = `{"q":`
	cut := func(truncated []string, final []string) MockResponseBuilder {
		return MockResponseBuilder{StreamFor: func(request []byte) []string {
			if callsOwnedTool(request) {
				return truncated
			}
			return final
		}}
	}
	anthropicCut := append(anthropicToolUseStart("msg-owned-tool", "toolu-owned-tool", OwnedToolWireName, map[string]any{}),
		sseEvent("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0,
			"delta": map[string]any{"type": "input_json_delta", "partial_json": partial}})...)
	chatCut := []string{chatToolCallChunk("chatcmpl-owned-tool", "call-owned-tool", OwnedToolWireName, partial)}
	responsesCut := append(responsesFunctionCallStart("resp-owned-tool", "call-owned-tool", OwnedToolWireName),
		responsesArgumentsDelta("resp-owned-tool", "call-owned-tool", partial))
	return Scenario{
		Name:        "mcp_truncated_owned_tool",
		Description: "Provider stream ends inside a server tool call, with no terminal event",
		Tags:        []string{"mcp", "servertool"},
		MockResponses: map[ResponseFormat]MockResponseBuilder{
			FormatAnthropic:       cut(anthropicCut, matrixAnthropicOwnedToolFinalStream()),
			FormatOpenAIChat:      cut(chatCut, matrixChatOwnedToolFinalStream()),
			FormatOpenAIResponses: cut(responsesCut, matrixResponsesOwnedToolFinalStream()),
		},
	}
}

// BlockStartInputOwnedToolScenario: an Anthropic provider streams the owned
// tool call with its full input already on content_block_start and no
// input_json_delta (valid on the wire: the block's input is complete at
// start). Once the call's result is in the request it answers with
// OwnedToolFinalText.
func BlockStartInputOwnedToolScenario() Scenario {
	round := append(anthropicToolUseStart("msg-owned-tool", "toolu-owned-tool", OwnedToolWireName, map[string]any{"q": "x"}),
		anthropicToolUseEnd()...)
	return Scenario{
		Name:        "mcp_block_start_input",
		Description: "Server tool input carried on content_block_start, no input_json_delta",
		Tags:        []string{"mcp", "servertool"},
		MockResponses: map[ResponseFormat]MockResponseBuilder{
			FormatAnthropic: {StreamFor: func(request []byte) []string {
				if callsOwnedTool(request) {
					return round
				}
				return matrixAnthropicOwnedToolFinalStream()
			}},
		},
	}
}

// CredentialAliasClientToolScenario: round 1 calls the owned echo tool (when
// offered); the next round calls the client tool get_weather with the
// credential's alias as its input — the model only ever saw the masked
// request, so the alias is all it can echo back.
func CredentialAliasClientToolScenario(alias string) Scenario {
	args := string(mustMarshal(map[string]any{"location": alias}))
	nonStream := func(v any) func([]byte) (int, []byte) {
		return func([]byte) (int, []byte) { return http.StatusOK, mustMarshal(v) }
	}
	stream := func(lines []string) func([]byte) []string {
		return func([]byte) []string { return lines }
	}
	return Scenario{
		Name:        "mcp_credential_alias_client_tool",
		Description: "Client tool call whose input carries a protected credential's alias",
		Tags:        []string{"mcp", "servertool", "guardrails"},
		MockResponses: map[ResponseFormat]MockResponseBuilder{
			FormatAnthropic: ownedToolRoundOr(FormatAnthropic, MockResponseBuilder{
				NonStreamFor: nonStream(anthropicToolUseMessage("msg-client-tool", "toolu-client-tool", clientToolName, map[string]any{"location": alias})),
				StreamFor:    stream(anthropicToolUseStream("msg-client-tool", "toolu-client-tool", clientToolName, args)),
			}),
			FormatOpenAIChat: ownedToolRoundOr(FormatOpenAIChat, MockResponseBuilder{
				NonStreamFor: nonStream(chatToolCallCompletion("chatcmpl-client-tool", "call-client-tool", clientToolName, args)),
				StreamFor:    stream(chatToolCallStream("chatcmpl-client-tool", "call-client-tool", clientToolName, args)),
			}),
			FormatOpenAIResponses: ownedToolRoundOr(FormatOpenAIResponses, MockResponseBuilder{
				NonStreamFor: nonStream(responsesFunctionCallResponse("resp-client-tool", "call-client-tool", clientToolName, args)),
				StreamFor:    stream(responsesFunctionCallStream("resp-client-tool", "call-client-tool", clientToolName, args)),
			}),
		},
	}
}
