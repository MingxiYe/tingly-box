package protocoltest

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/tingly-dev/tingly-box/internal/guardrails"
	guardrailscore "github.com/tingly-dev/tingly-box/internal/guardrails/core"
	"github.com/tingly-dev/tingly-box/internal/protocol"
)

// newBlockToolUseGuardrails returns an active runtime that blocks every
// response-side tool call and allows everything else.
func newBlockToolUseGuardrails() *guardrails.Guardrails {
	return &guardrails.Guardrails{
		Policy: guardrailsPolicyFunc(func(_ context.Context, input guardrailscore.Input) (guardrailscore.Result, error) {
			if input.Direction == guardrailscore.DirectionResponse && input.Content.Command != nil {
				return guardrailscore.Result{
					Verdict: guardrailscore.VerdictBlock,
					Reasons: []guardrailscore.PolicyResult{{
						PolicyID: "protocoltest-block-tool-use",
						Verdict:  guardrailscore.VerdictBlock,
						Reason:   "tool use denied by test policy",
					}},
				}, nil
			}
			return guardrailscore.Result{Verdict: guardrailscore.VerdictAllow}, nil
		}),
		HasActivePolicies: true,
	}
}

// TestGuardrailsBlocksToolUse pins that a blocked response tool_use never
// reaches an Anthropic client, whichever provider protocol served it.
func TestGuardrailsBlocksToolUse(t *testing.T) {
	t.Parallel()

	for _, source := range anthropicSources {
		for _, target := range guardrailsTargets {
			for _, streaming := range []bool{false, true} {
				source, target, streaming := source, target, streaming
				t.Run(fmt.Sprintf("%s->%s/stream=%v", source, target, streaming), func(t *testing.T) {
					t.Parallel()

					env := NewTestEnv(t, NewTestEnvOptionWithGuardrails(newBlockToolUseGuardrails()))
					scenario := ToolUseScenario()
					if streaming {
						scenario = StreamingToolUseScenario()
					}
					env.SetupRoute(source, target, scenario)
					model := env.findRouteModel(source, target, scenario.Name)
					path, body := buildRequest(source, model, streaming)

					status, raw := sendRaw(t, env, path, body)
					checkCase(t, t.Name(), blockedToolUseFailures(status, raw), "client response:\n"+raw)
				})
			}
		}
	}
}

// TestGuardrailsRestoresCredentialAliasAnthropic pins that a protected
// credential masked on the way upstream comes back to the client as the real
// value in a non-stream response, not as the alias token.
func TestGuardrailsRestoresCredentialAliasAnthropic(t *testing.T) {
	t.Parallel()

	const (
		secret = "sk-protocoltest-secret"
		alias  = "TINGLY_CRED_TOKEN_PROTOCOLTEST"
	)
	for _, source := range []protocol.APIType{protocol.TypeAnthropicV1, protocol.TypeAnthropicBeta} {
		source := source
		t.Run(string(source), func(t *testing.T) {
			t.Parallel()

			runtime := &guardrails.Guardrails{
				Policy: guardrailsPolicyFunc(func(context.Context, guardrailscore.Input) (guardrailscore.Result, error) {
					return guardrailscore.Result{Verdict: guardrailscore.VerdictAllow}, nil
				}),
				HasActivePolicies: true,
			}
			env := NewTestEnv(t, NewTestEnvOptionWithGuardrails(runtime))
			installProtectedCredential(env, secret, alias)

			scenario := Scenario{
				Name: "credential_restore",
				MockResponses: map[ResponseFormat]MockResponseBuilder{
					FormatAnthropic: {
						NonStream: func() (int, []byte) {
							return http.StatusOK, mustMarshal(map[string]any{
								"id": "msg-credential", "type": "message", "role": "assistant",
								"content": []map[string]any{{"type": "text", "text": "key is " + alias}},
								"model":   "provider-model", "stop_reason": "end_turn", "stop_sequence": nil,
								"usage": map[string]any{"input_tokens": 1, "output_tokens": 1},
							})
						},
					},
				},
			}
			env.SetupRoute(source, source, scenario)
			model := env.findRouteModel(source, source, scenario.Name)
			path, body := buildRequest(source, model, false)
			// The alias is only registered once the request actually carries
			// the secret and request-side guardrails mask it.
			body = bytes.Replace(body, []byte("What is the capital of France?"), []byte("use "+secret), 1)

			status, raw := sendRaw(t, env, path, body)
			if status != http.StatusOK {
				t.Fatalf("status = %d: %s", status, raw)
			}
			if upstream := string(env.virtual.LastRequest(EndpointAnthropic).Body); strings.Contains(upstream, secret) {
				t.Fatalf("secret reached upstream unmasked:\n%s", upstream)
			}
			if strings.Contains(raw, alias) {
				t.Fatalf("credential alias leaked to client:\n%s", raw)
			}
			if !strings.Contains(raw, secret) {
				t.Fatalf("credential was not restored:\n%s", raw)
			}
		})
	}
}
