package protocoltest

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/tingly-dev/tingly-box/internal/guardrails"
	guardrailscore "github.com/tingly-dev/tingly-box/internal/guardrails/core"
	"github.com/tingly-dev/tingly-box/internal/protocol"
)

// Guardrails fixtures shared by the guardrails go tests and the servertool
// section (Guardrails x MCP cases).

// guardrailsPolicyFunc adapts a function into a guardrails policy so a case
// can decide verdicts from the evaluated input.
type guardrailsPolicyFunc func(context.Context, guardrailscore.Input) (guardrailscore.Result, error)

func (f guardrailsPolicyFunc) Evaluate(ctx context.Context, input guardrailscore.Input) (guardrailscore.Result, error) {
	return f(ctx, input)
}

// Guardrails applies to the Anthropic scenarios only (GuardrailsSupportedScenarios);
// whether OpenAI ingress gets it is an open product decision, so only
// Anthropic sources are asserted.
var anthropicSources = []protocol.APIType{protocol.TypeAnthropicV1, protocol.TypeAnthropicBeta}

// blockVerdict is the block result the test policies return.
func blockVerdict(policyID, reason string) guardrailscore.Result {
	return guardrailscore.Result{
		Verdict: guardrailscore.VerdictBlock,
		Reasons: []guardrailscore.PolicyResult{{PolicyID: policyID, Verdict: guardrailscore.VerdictBlock, Reason: reason}},
	}
}

// newBlockToolNamedGuardrails blocks response tool calls whose name contains
// fragment and allows everything else.
func newBlockToolNamedGuardrails(fragment string) *guardrails.Guardrails {
	return &guardrails.Guardrails{
		Policy: guardrailsPolicyFunc(func(_ context.Context, input guardrailscore.Input) (guardrailscore.Result, error) {
			if input.Direction == guardrailscore.DirectionResponse && input.Content.Command != nil &&
				strings.Contains(input.Content.Command.Name, fragment) {
				return blockVerdict("protocoltest-block-named", "denied by test policy"), nil
			}
			return guardrailscore.Result{Verdict: guardrailscore.VerdictAllow}, nil
		}),
		HasActivePolicies: true,
	}
}

// newBlockResponseContainingGuardrails blocks any response-side evaluation
// whose content (text, messages, or tool call and its arguments) contains
// pattern, and allows everything else.
func newBlockResponseContainingGuardrails(pattern string) *guardrails.Guardrails {
	return &guardrails.Guardrails{
		Policy: guardrailsPolicyFunc(func(_ context.Context, input guardrailscore.Input) (guardrailscore.Result, error) {
			if input.Direction == guardrailscore.DirectionResponse && strings.Contains(string(mustMarshal(input.Content)), pattern) {
				return blockVerdict("protocoltest-block-pattern", "response matched the protected pattern"), nil
			}
			return guardrailscore.Result{Verdict: guardrailscore.VerdictAllow}, nil
		}),
		HasActivePolicies: true,
	}
}

// installProtectedCredential registers one protected token credential on the
// env's live guardrails runtime for the Anthropic scenario. Server boot
// refreshes the runtime's cache from the (empty) test database, so it must be
// installed after the env exists.
func installProtectedCredential(env *TestEnv, secret, alias string) {
	env.srv.CurrentGuardrailsRuntime().SetCredentialCache(guardrails.BuildCredentialCache(
		[]guardrailscore.ProtectedCredential{{
			ID: "protocoltest-credential", Name: "protocoltest credential",
			Type: guardrailscore.ProtectedCredentialTypeToken, Secret: secret, AliasToken: alias, Enabled: true,
		}},
		[]string{"anthropic"},
	))
}

// blockedToolUseFailures lists how an Anthropic client response violates
// "the blocked tool_use was replaced by the guardrails message".
func blockedToolUseFailures(status int, raw string) []string {
	var failures []string
	if status != http.StatusOK {
		failures = append(failures, fmt.Sprintf("status = %d", status))
	}
	if strings.Contains(raw, `"type":"tool_use"`) {
		failures = append(failures, "blocked tool_use leaked to client")
	}
	if strings.Contains(raw, `"stop_reason":"tool_use"`) {
		failures = append(failures, "stop_reason still tool_use after block")
	}
	if !strings.Contains(raw, "Blocked by guardrails") {
		failures = append(failures, "no block message in response")
	}
	return failures
}
