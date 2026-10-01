package wire

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChatCompletionMessageWireMarshalNullables(t *testing.T) {
	toolCall := ChatCompletionToolCallWire{ID: "call_1", Type: "function", Function: ChatCompletionFunctionWire{Name: "f", Arguments: "{}"}}
	cases := []struct {
		name        string
		msg         ChatCompletionMessageWire
		wantContent any
		wantRefusal any
	}{
		{"text", ChatCompletionMessageWire{Role: "assistant", Content: "hi"}, "hi", nil},
		{"empty text stays empty string", ChatCompletionMessageWire{Role: "assistant"}, "", nil},
		{"tool calls only", ChatCompletionMessageWire{Role: "assistant", ToolCalls: []ChatCompletionToolCallWire{toolCall}}, nil, nil},
		{"refusal", ChatCompletionMessageWire{Role: "assistant", Refusal: "no"}, nil, "no"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.msg)
			require.NoError(t, err)
			var got map[string]any
			require.NoError(t, json.Unmarshal(raw, &got))
			require.Contains(t, got, "content")
			require.Contains(t, got, "refusal")
			assert.Equal(t, tc.wantContent, got["content"])
			assert.Equal(t, tc.wantRefusal, got["refusal"])
			assert.Equal(t, "assistant", got["role"])
		})
	}
}
