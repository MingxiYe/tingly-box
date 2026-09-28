package stage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/tingly-dev/tingly-box/internal/protocol"
)

func TestAdaptRejectsInvalidBoundary(t *testing.T) {
	t.Parallel()

	validEndpoint := &recordingEndpoint{protocol: protocol.TypeAnthropicBeta}
	validBridge := func() *testingBridge {
		return &testingBridge{
			name:   "bridge",
			source: protocol.TypeOpenAIChat,
			target: protocol.TypeAnthropicBeta,
		}
	}

	tests := []struct {
		name   string
		next   Endpoint
		bridge Bridge
		want   string
	}{
		{name: "nil endpoint", bridge: validBridge(), want: "target endpoint is nil"},
		{name: "nil bridge", next: validEndpoint, want: "bridge is nil"},
		{
			name:   "empty source",
			next:   validEndpoint,
			bridge: &testingBridge{target: protocol.TypeAnthropicBeta},
			want:   "source: empty protocol",
		},
		{
			name:   "empty target",
			next:   validEndpoint,
			bridge: &testingBridge{source: protocol.TypeOpenAIChat},
			want:   "target: empty protocol",
		},
		{
			name:   "empty endpoint protocol",
			next:   &recordingEndpoint{},
			bridge: validBridge(),
			want:   `cannot call endpoint speaking ""`,
		},
		{
			name: "target mismatch",
			next: &recordingEndpoint{protocol: protocol.TypeOpenAIResponses},
			bridge: &testingBridge{
				source: protocol.TypeOpenAIChat,
				target: protocol.TypeAnthropicBeta,
			},
			want: `cannot call endpoint speaking "openai_responses"`,
		},
		{name: "valid baseline", next: validEndpoint, bridge: validBridge()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := Adapt(tt.next, tt.bridge)
			if tt.want == "" {
				if err != nil {
					t.Fatalf("Adapt() error = %v", err)
				}
				if got == nil {
					t.Fatal("Adapt() returned nil endpoint")
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("Adapt() error = %v, want containing %q", err, tt.want)
			}
		})
	}
}

func TestAdaptRuntimeFailures(t *testing.T) {
	t.Parallel()

	upstreamErr := errors.New("upstream failed")
	conversionErr := errors.New("stream conversion failed")

	t.Run("request conversion error", func(t *testing.T) {
		endpoint := &failureEndpoint{protocol: protocol.TypeAnthropicBeta}
		bridge := validTestingBridge()
		bridge.openErr = errors.New("request conversion failed")
		adapted := mustAdapt(t, endpoint, bridge)

		_, err := adapted.Complete(context.Background(), Call{})
		if !errors.Is(err, bridge.openErr) {
			t.Fatalf("Complete() error = %v", err)
		}
		if endpoint.completeCalls != 0 {
			t.Fatal("target endpoint executed after request conversion error")
		}
	})

	t.Run("nil session", func(t *testing.T) {
		endpoint := &failureEndpoint{protocol: protocol.TypeAnthropicBeta}
		bridge := validTestingBridge()
		bridge.nilSession = true
		adapted := mustAdapt(t, endpoint, bridge)

		_, err := adapted.Complete(context.Background(), Call{})
		if err == nil || !strings.Contains(err.Error(), "Open returned a nil session") {
			t.Fatalf("Complete() error = %v", err)
		}
	})

	t.Run("target error returned unchanged", func(t *testing.T) {
		endpoint := &failureEndpoint{protocol: protocol.TypeAnthropicBeta, completeErr: upstreamErr}
		adapted := mustAdapt(t, endpoint, validTestingBridge())

		_, err := adapted.Complete(context.Background(), Call{})
		if err != upstreamErr {
			t.Fatalf("Complete() error = %v, want the target's error unchanged", err)
		}
	})

	t.Run("nil target response", func(t *testing.T) {
		endpoint := &failureEndpoint{protocol: protocol.TypeAnthropicBeta}
		adapted := mustAdapt(t, endpoint, validTestingBridge())

		_, err := adapted.Complete(context.Background(), Call{})
		if err == nil || !strings.Contains(err.Error(), "target endpoint returned a nil response") {
			t.Fatalf("Complete() error = %v", err)
		}
	})

	t.Run("nil converted response", func(t *testing.T) {
		endpoint := &failureEndpoint{protocol: protocol.TypeAnthropicBeta, response: &Response{Value: "ok"}}
		bridge := validTestingBridge()
		bridge.nilResponse = true
		adapted := mustAdapt(t, endpoint, bridge)

		_, err := adapted.Complete(context.Background(), Call{})
		if err == nil || !strings.Contains(err.Error(), "nil converted response") {
			t.Fatalf("Complete() error = %v", err)
		}
	})

	t.Run("target stream open error returned unchanged", func(t *testing.T) {
		endpoint := &failureEndpoint{protocol: protocol.TypeAnthropicBeta, streamErr: upstreamErr}
		adapted := mustAdapt(t, endpoint, validTestingBridge())

		_, err := adapted.Stream(context.Background(), Call{})
		if err != upstreamErr {
			t.Fatalf("Stream() error = %v, want the target's error unchanged", err)
		}
	})

	t.Run("usage kept when the conversion reports none", func(t *testing.T) {
		usage := protocol.NewTokenUsage(7, 3)
		targetStream := &recordingEventStream{result: StreamResult{Usage: usage}}
		endpoint := &failureEndpoint{
			protocol: protocol.TypeAnthropicBeta,
			response: &Response{Value: "ok", Usage: usage},
			stream:   targetStream,
		}
		bridge := validTestingBridge()
		bridge.dropFacts = true
		adapted := mustAdapt(t, endpoint, bridge)

		response, err := adapted.Complete(context.Background(), Call{})
		if err != nil || response.Usage != usage {
			t.Fatalf("Complete() = %+v, %v; want the target's usage", response, err)
		}
		stream, err := adapted.Stream(context.Background(), Call{})
		if err != nil {
			t.Fatalf("Stream() error = %v", err)
		}
		if got := stream.Result().Usage; got != usage {
			t.Fatalf("Result().Usage = %v, want the target's usage", got)
		}
	})

	t.Run("nil target stream", func(t *testing.T) {
		endpoint := &failureEndpoint{protocol: protocol.TypeAnthropicBeta}
		adapted := mustAdapt(t, endpoint, validTestingBridge())

		_, err := adapted.Stream(context.Background(), Call{})
		if err == nil || !strings.Contains(err.Error(), "target endpoint returned a nil stream") {
			t.Fatalf("Stream() error = %v", err)
		}
	})

	t.Run("stream conversion error closes target", func(t *testing.T) {
		targetStream := &recordingEventStream{}
		endpoint := &failureEndpoint{protocol: protocol.TypeAnthropicBeta, stream: targetStream}
		bridge := validTestingBridge()
		bridge.streamConversionErr = conversionErr
		adapted := mustAdapt(t, endpoint, bridge)

		_, err := adapted.Stream(context.Background(), Call{})
		if !errors.Is(err, conversionErr) {
			t.Fatalf("Stream() error = %v", err)
		}
		if targetStream.closeCount != 1 {
			t.Fatalf("target close count = %d, want 1", targetStream.closeCount)
		}
	})

	t.Run("nil converted stream closes target", func(t *testing.T) {
		targetStream := &recordingEventStream{}
		endpoint := &failureEndpoint{protocol: protocol.TypeAnthropicBeta, stream: targetStream}
		bridge := validTestingBridge()
		bridge.nilStream = true
		adapted := mustAdapt(t, endpoint, bridge)

		_, err := adapted.Stream(context.Background(), Call{})
		if err == nil || !strings.Contains(err.Error(), "nil converted stream") {
			t.Fatalf("Stream() error = %v", err)
		}
		if targetStream.closeCount != 1 {
			t.Fatalf("target close count = %d, want 1", targetStream.closeCount)
		}
	})
}

func TestAdaptPassthroughPreservesValuesAndState(t *testing.T) {
	t.Parallel()

	usage := protocol.NewTokenUsage(5, 2)
	targetStream := &recordingEventStream{
		events: []Event{{Value: "event"}},
		result: StreamResult{Usage: usage},
	}
	terminal := &recordingEndpoint{
		protocol: protocol.TypeAnthropicBeta,
		response: &Response{Value: "response", Usage: usage},
		stream:   targetStream,
	}
	adapted := mustAdapt(t, terminal, passthroughBridge{api: protocol.TypeAnthropicBeta})

	config := &protocol.OpenAIConfig{HasThinking: true}
	call := Call{Request: "request", State: ProtocolState{OpenAIChat: config}}
	response, err := adapted.Complete(context.Background(), call)
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if response.Value != "response" {
		t.Fatalf("response.Value = %v", response.Value)
	}
	if response.Usage != usage {
		t.Fatalf("response.Usage = %v, want %v", response.Usage, usage)
	}

	if terminal.lastCall.State.OpenAIChat != config {
		t.Fatal("passthrough complete call did not preserve protocol state")
	}

	stream, err := adapted.Stream(context.Background(), call)
	if err != nil {
		t.Fatalf("Stream() error = %v", err)
	}
	event, err := stream.Next(context.Background())
	if err != nil || event.Value != "event" {
		t.Fatalf("Next() = (%+v, %v)", event, err)
	}
	if got := stream.Result(); got.Usage != usage {
		t.Fatalf("Result() = %+v", got)
	}
	if err := stream.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	if targetStream.closeCount != 1 {
		t.Fatalf("target close count = %d, want 1", targetStream.closeCount)
	}
	if terminal.lastCall.State.OpenAIChat != config {
		t.Fatal("identity stream call did not preserve protocol state")
	}
}

func TestOperationString(t *testing.T) {
	t.Parallel()

	if OperationComplete.String() != "complete" || OperationStream.String() != "stream" {
		t.Fatalf("operation strings = %q, %q", OperationComplete, OperationStream)
	}
	if got := Operation(99).String(); got != "unknown(99)" {
		t.Fatalf("unknown operation string = %q", got)
	}
}

func mustAdapt(t *testing.T, endpoint Endpoint, bridge Bridge) Endpoint {
	t.Helper()
	adapted, err := Adapt(endpoint, bridge)
	if err != nil {
		t.Fatalf("Adapt() error = %v", err)
	}
	return adapted
}

func validTestingBridge() *testingBridge {
	return &testingBridge{
		name:   "bridge",
		source: protocol.TypeOpenAIChat,
		target: protocol.TypeAnthropicBeta,
	}
}

type testingBridge struct {
	name                string
	source              protocol.APIType
	target              protocol.APIType
	calls               *[]string
	dropFacts           bool
	openErr             error
	nilSession          bool
	nilResponse         bool
	streamConversionErr error
	nilStream           bool
	openCount           int
	sessions            []*testingBridgeSession
	operations          []Operation
}

func (b *testingBridge) Source() protocol.APIType {
	return b.source
}

func (b *testingBridge) Target() protocol.APIType {
	return b.target
}

func (b *testingBridge) Open(_ context.Context, call Call, operation Operation) (BridgeSession, error) {
	if b.openErr != nil {
		return nil, b.openErr
	}
	b.append(b.name + ":request")
	b.operations = append(b.operations, operation)
	b.openCount++
	if b.nilSession {
		return nil, nil
	}

	session := &testingBridgeSession{
		bridge: b,
		call: Call{
			Request: fmt.Sprintf("%s(%v)", b.name, call.Request),
		},
	}
	b.sessions = append(b.sessions, session)
	return session, nil
}

func (b *testingBridge) append(value string) {
	if b.calls != nil {
		*b.calls = append(*b.calls, value)
	}
}

type testingBridgeSession struct {
	bridge *testingBridge
	call   Call
}

func (s *testingBridgeSession) TargetCall() Call {
	return s.call
}

func (s *testingBridgeSession) ConvertComplete(_ context.Context, response *Response) (*Response, error) {
	s.bridge.append(s.bridge.name + ":response")
	if s.bridge.nilResponse {
		return nil, nil
	}
	converted := &Response{Value: fmt.Sprintf("%s(%v)", s.bridge.name, response.Value)}
	if !s.bridge.dropFacts {
		converted.Usage = response.Usage
	}
	return converted, nil
}

func (s *testingBridgeSession) ConvertStream(_ context.Context, stream EventStream) (EventStream, error) {
	if s.bridge.streamConversionErr != nil {
		return nil, s.bridge.streamConversionErr
	}
	if s.bridge.nilStream {
		return nil, nil
	}
	return &testingBridgeStream{bridge: s.bridge, target: stream}, nil
}

type testingBridgeStream struct {
	bridge *testingBridge
	target EventStream
}

func (s *testingBridgeStream) Next(ctx context.Context) (Event, error) {
	event, err := s.target.Next(ctx)
	switch {
	case err == nil:
		s.bridge.append(s.bridge.name + ":event")
		event.Value = fmt.Sprintf("%s(%v)", s.bridge.name, event.Value)
	case errors.Is(err, io.EOF):
		s.bridge.append(s.bridge.name + ":eof")
	default:
		err = fmt.Errorf("%s: %w", s.bridge.name, err)
	}
	return event, err
}

func (s *testingBridgeStream) Close() error {
	s.bridge.append(s.bridge.name + ":close")
	return s.target.Close()
}

func (s *testingBridgeStream) Result() StreamResult {
	if s.bridge.dropFacts {
		return StreamResult{}
	}
	return s.target.Result()
}

type failureEndpoint struct {
	protocol      protocol.APIType
	response      *Response
	completeErr   error
	stream        EventStream
	streamErr     error
	completeCalls int
	streamCalls   int
}

func (e *failureEndpoint) Protocol() protocol.APIType {
	return e.protocol
}

func (e *failureEndpoint) Complete(_ context.Context, _ Call) (*Response, error) {
	e.completeCalls++
	return e.response, e.completeErr
}

func (e *failureEndpoint) Stream(_ context.Context, _ Call) (EventStream, error) {
	e.streamCalls++
	return e.stream, e.streamErr
}

// passthroughBridge is a same-protocol Bridge that converts nothing, for
// checking what Adapt itself carries across a boundary.
type passthroughBridge struct {
	api protocol.APIType
}

func (b passthroughBridge) Source() protocol.APIType {
	return b.api
}

func (b passthroughBridge) Target() protocol.APIType {
	return b.api
}

func (b passthroughBridge) Open(_ context.Context, call Call, _ Operation) (BridgeSession, error) {
	return &passthroughBridgeSession{call: call}, nil
}

type passthroughBridgeSession struct {
	call Call
}

func (s *passthroughBridgeSession) TargetCall() Call {
	return s.call
}

func (s *passthroughBridgeSession) ConvertComplete(_ context.Context, response *Response) (*Response, error) {
	return response, nil
}

func (s *passthroughBridgeSession) ConvertStream(_ context.Context, stream EventStream) (EventStream, error) {
	return stream, nil
}
