package protocoltest

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/gin-gonic/gin"
	"github.com/openai/openai-go/v3"
	openaistream "github.com/openai/openai-go/v3/packages/ssestream"
	"github.com/openai/openai-go/v3/responses"

	"github.com/tingly-dev/tingly-box/internal/protocol"
	"github.com/tingly-dev/tingly-box/internal/protocol/nonstream"
	"github.com/tingly-dev/tingly-box/internal/protocol/sse"
	"github.com/tingly-dev/tingly-box/internal/protocol/stage"
	"github.com/tingly-dev/tingly-box/internal/protocol/stage/anthropicbridge"
	"github.com/tingly-dev/tingly-box/internal/protocol/stream"
	"github.com/tingly-dev/tingly-box/internal/protocol/transform"
)

// The bridges replace, one for one, the conversions the legacy paths perform
// for an Anthropic Beta client on an OpenAI provider: BaseTransform on the way
// up, and the legacy non-stream converters and stream handlers on the way
// down. These tests run both on the same input and require the same output,
// so the bridges are proven equivalent before any route uses them.
//
// Options mirror how the legacy paths call the converters: Chat requests are
// converted in compatible mode with stream usage on, and the client-visible
// model is the response model.

const equivalenceResponseModel = "client-visible-model"

func equivalenceBridges() []stage.Bridge {
	return []stage.Bridge{
		anthropicbridge.NewBetaToOpenAIChat(anthropicbridge.ChatOptions{ResponseModel: equivalenceResponseModel}),
		anthropicbridge.NewBetaToOpenAIResponses(anthropicbridge.ResponsesOptions{ResponseModel: equivalenceResponseModel}),
	}
}

// equivalenceRequests is a corpus of Anthropic Beta requests covering the
// fields the request converters treat differently.
var equivalenceRequests = map[string]string{
	"text": `{"model":"provider-model","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}`,
	"system_tools_history": `{"model":"provider-model","max_tokens":64,
		"system":[{"type":"text","text":"sys","cache_control":{"type":"ephemeral"}}],
		"tools":[{"name":"get_weather","description":"weather","input_schema":{"type":"object","properties":{"location":{"type":"string"}},"required":["location"]}}],
		"tool_choice":{"type":"auto"},
		"messages":[{"role":"user","content":"weather?"},
			{"role":"assistant","content":[{"type":"text","text":"checking"},{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{"location":"Paris"}}]},
			{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"18C"},{"type":"text","text":"and tomorrow?"}]}]}`,
	"tool_choice_named": `{"model":"provider-model","max_tokens":64,
		"tools":[{"name":"lookup","input_schema":{"type":"object","properties":{"q":{"type":"string"}}}}],
		"tool_choice":{"type":"tool","name":"lookup"},
		"messages":[{"role":"user","content":"look it up"}]}`,
	"thinking": `{"model":"provider-model","max_tokens":2048,"thinking":{"type":"enabled","budget_tokens":1024},
		"messages":[{"role":"user","content":"think"},
			{"role":"assistant","content":[{"type":"thinking","thinking":"hmm","signature":"sig"},{"type":"text","text":"done"}]},
			{"role":"user","content":"again"}]}`,
	"sampling_stop": `{"model":"provider-model","max_tokens":128,"temperature":0.3,"top_p":0.9,"top_k":40,
		"stop_sequences":["END"],"metadata":{"user_id":"u-1"},
		"messages":[{"role":"user","content":"count"}]}`,
	"image": `{"model":"provider-model","max_tokens":64,
		"messages":[{"role":"user","content":[
			{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBORw0KGgo="}},
			{"type":"image","source":{"type":"url","url":"https://example.com/cat.png"}},
			{"type":"text","text":"what is this?"}]}]}`,
}

// TestBridgeRequestEquivalence pins each bridge's provider-bound request, and
// the OpenAI Chat config it carries for the vendor transforms, to what
// BaseTransform produces for the same request.
func TestBridgeRequestEquivalence(t *testing.T) {
	t.Parallel()
	for _, bridge := range equivalenceBridges() {
		for name, body := range equivalenceRequests {
			for _, streaming := range []bool{false, true} {
				bridge, name, body, streaming := bridge, name, body, streaming
				t.Run(fmt.Sprintf("%s/%s/%s", bridge.Target(), name, streamMode(streaming)), func(t *testing.T) {
					t.Parallel()
					legacy := decodeBeta(t, body)
					ctx := transform.NewTransformContext(legacy, transform.WithStreaming(streaming))
					if err := transform.NewBaseTransform(bridge.Target()).Apply(ctx); err != nil {
						t.Fatalf("BaseTransform: %v", err)
					}

					operation := stage.OperationComplete
					if streaming {
						operation = stage.OperationStream
					}
					session, err := bridge.Open(context.Background(), stage.Call{Request: decodeBeta(t, body)}, operation)
					if err != nil {
						t.Fatalf("bridge open: %v", err)
					}
					target := session.TargetCall()

					requireSameJSON(t, "provider request", mustMarshal(ctx.Request), mustMarshal(target.Request))
					if bridge.Target() == protocol.TypeOpenAIChat {
						requireSameJSON(t, "OpenAI Chat config", mustMarshal(ctx.Config.OpenAIConfig), mustMarshal(target.State.OpenAIChat))
					}
				})
			}
		}
	}
}

// TestBridgeResponseEquivalence pins each bridge's client-visible answer to
// the legacy one for every successful scenario the provider format has a
// fixture for: the complete message through the legacy non-stream converter,
// and the stream event by event through the legacy stream handler.
func TestBridgeResponseEquivalence(t *testing.T) {
	t.Parallel()
	for _, bridge := range equivalenceBridges() {
		for _, s := range AllScenarios() {
			for _, streaming := range []bool{false, true} {
				bridge, s, streaming := bridge, s, streaming
				t.Run(fmt.Sprintf("%s/%s/%s", bridge.Target(), s.Name, streamMode(streaming)), func(t *testing.T) {
					t.Parallel()
					if reason, skip := bridgeMatrixSkip(s, bridge, streaming); skip {
						t.Skip(reason)
					}
					mock := s.MockResponses[targetFormat(bridge.Target())]
					if !streaming {
						requireSameJSON(t, "complete message",
							legacyCompleteBody(t, bridge.Target(), mock),
							bridgeCompleteBody(t, bridge, mock))
						return
					}
					legacy := legacyStreamPayloads(t, bridge.Target(), mock)
					bridged := bridgeStreamPayloads(t, bridge, mock)
					if len(legacy) != len(bridged) {
						t.Fatalf("event count: legacy %d, bridge %d\nlegacy:\n%s\nbridge:\n%s",
							len(legacy), len(bridged), strings.Join(legacy, "\n"), strings.Join(bridged, "\n"))
					}
					for i := range legacy {
						requireSameJSON(t, fmt.Sprintf("stream event %d", i), []byte(legacy[i]), []byte(bridged[i]))
					}
				})
			}
		}
	}
}

func decodeBeta(t *testing.T, body string) *anthropic.BetaMessageNewParams {
	t.Helper()
	var req anthropic.BetaMessageNewParams
	if err := json.Unmarshal([]byte(body), &req); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	return &req
}

// requireSameJSON compares two JSON documents after the golden normalization
// (sorted keys, numbered IDs, blanked timestamps).
func requireSameJSON(t *testing.T, what string, legacy, bridged []byte) {
	t.Helper()
	want := normalizeGolden(goldenJSON(legacy))
	got := normalizeGolden(goldenJSON(bridged))
	if want != got {
		t.Fatalf("%s differs from the legacy path\n--- legacy\n%s\n+++ bridge\n%s", what, want, got)
	}
}

func legacyCompleteBody(t *testing.T, target protocol.APIType, mock MockResponseBuilder) []byte {
	t.Helper()
	_, body := mock.NonStream()
	var message anthropic.BetaMessage
	switch target {
	case protocol.TypeOpenAIChat:
		var completion openai.ChatCompletion
		if err := json.Unmarshal(body, &completion); err != nil {
			t.Fatalf("decode fixture: %v", err)
		}
		message = nonstream.HandleOpenAIChatToAnthropicBeta(&completion, equivalenceResponseModel)
	case protocol.TypeOpenAIResponses:
		var response responses.Response
		if err := json.Unmarshal(body, &response); err != nil {
			t.Fatalf("decode fixture: %v", err)
		}
		message = nonstream.HandleResponsesToAnthropicBeta(&response, equivalenceResponseModel)
	}
	return writeAnthropicMessage(t, message)
}

func bridgeCompleteBody(t *testing.T, bridge stage.Bridge, mock MockResponseBuilder) []byte {
	t.Helper()
	endpoint, err := stage.Adapt(&fixtureEndpoint{protocol: bridge.Target(), mock: mock}, bridge)
	if err != nil {
		t.Fatalf("adapt: %v", err)
	}
	request, err := sourceRequest(bridge.Source(), false)
	if err != nil {
		t.Fatalf("source request: %v", err)
	}
	response, err := endpoint.Complete(context.Background(), stage.Call{Request: request})
	if err != nil {
		t.Fatalf("bridge complete: %v", err)
	}
	return writeAnthropicMessage(t, response.Value)
}

// writeAnthropicMessage renders a message through the writer every
// Anthropic client path shares, so both sides are compared as sent.
func writeAnthropicMessage(t *testing.T, message any) []byte {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	nonstream.WriteAnthropicMessage(c, message)
	return w.Body.Bytes()
}

// legacyStreamPayloads runs the legacy stream handler on the fixture, decoded
// by the SDK's own SSE decoder as it is from a provider, and returns the data
// payloads it writes to the client.
func legacyStreamPayloads(t *testing.T, target protocol.APIType, mock MockResponseBuilder) []string {
	t.Helper()
	upstream := httptest.NewRecorder()
	sse.WriteSSEResponse(upstream, mock.Stream())
	response := upstream.Result()

	w := &closeNotifyRecorder{ResponseRecorder: httptest.NewRecorder()}
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	hc := protocol.NewHandleContext(c, equivalenceResponseModel)

	var err error
	switch target {
	case protocol.TypeOpenAIChat:
		chunks := openaistream.NewStream[openai.ChatCompletionChunk](openaistream.NewDecoder(response), nil)
		request, rerr := sourceRequest(protocol.TypeAnthropicBeta, true)
		if rerr != nil {
			t.Fatalf("source request: %v", rerr)
		}
		chat, _ := convertedChatRequest(t, request.(*anthropic.BetaMessageNewParams))
		_, err = stream.HandleOpenAIToAnthropicBetaStreamWithMCPHooks(hc, chat, chunks, equivalenceResponseModel, nil)
	case protocol.TypeOpenAIResponses:
		events := openaistream.NewStream[responses.ResponseStreamEventUnion](openaistream.NewDecoder(response), nil)
		_, err = stream.HandleResponsesToAnthropicBetaStream(hc, events, equivalenceResponseModel)
	}
	if err != nil {
		t.Fatalf("legacy stream handler: %v", err)
	}
	var payloads []string
	for _, line := range strings.Split(w.Body.String(), "\n") {
		if payload, ok := sse.ParseSSEDataPayload(strings.TrimSpace(line)); ok {
			payloads = append(payloads, payload)
		}
	}
	return payloads
}

// convertedChatRequest is the Chat request the legacy stream handler receives:
// the client's request after BaseTransform.
func convertedChatRequest(t *testing.T, req *anthropic.BetaMessageNewParams) (*openai.ChatCompletionNewParams, *protocol.OpenAIConfig) {
	t.Helper()
	ctx := transform.NewTransformContext(req, transform.WithStreaming(true))
	if err := transform.NewBaseTransform(protocol.TypeOpenAIChat).Apply(ctx); err != nil {
		t.Fatalf("BaseTransform: %v", err)
	}
	return ctx.Request.(*openai.ChatCompletionNewParams), ctx.Config.OpenAIConfig
}

func bridgeStreamPayloads(t *testing.T, bridge stage.Bridge, mock MockResponseBuilder) []string {
	t.Helper()
	endpoint, err := stage.Adapt(&fixtureEndpoint{protocol: bridge.Target(), mock: mock}, bridge)
	if err != nil {
		t.Fatalf("adapt: %v", err)
	}
	request, err := sourceRequest(bridge.Source(), true)
	if err != nil {
		t.Fatalf("source request: %v", err)
	}
	ctx := context.Background()
	events, err := endpoint.Stream(ctx, stage.Call{Request: request})
	if err != nil {
		t.Fatalf("bridge stream: %v", err)
	}
	defer events.Close()
	var payloads []string
	for {
		event, err := events.Next(ctx)
		if errors.Is(err, io.EOF) {
			return payloads
		}
		if err != nil {
			t.Fatalf("bridge stream event: %v", err)
		}
		data, err := wireJSON(event.Value)
		if err != nil {
			t.Fatalf("render event: %v", err)
		}
		payloads = append(payloads, data)
	}
}

// closeNotifyRecorder gives the stream handlers the CloseNotifier a real
// connection provides.
type closeNotifyRecorder struct {
	*httptest.ResponseRecorder
}

func (r *closeNotifyRecorder) CloseNotify() <-chan bool { return make(chan bool) }
