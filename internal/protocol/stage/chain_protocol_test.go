package stage

import (
	"strings"
	"testing"

	"github.com/tingly-dev/tingly-box/internal/protocol"
)

// Anthropic V1 lives only at the edges (upgraded to Beta at the client,
// downgraded at the provider when needed), so Compose and Adapt reject it
// before anything executes.
func TestChainRejectsAnthropicV1(t *testing.T) {
	t.Parallel()

	const want = `"anthropic_v1" is handled at the edges`
	beta := &recordingEndpoint{protocol: protocol.TypeAnthropicBeta}
	check := func(t *testing.T, err error) {
		t.Helper()
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Fatalf("error = %v, want containing %q", err, want)
		}
	}

	t.Run("compose terminal", func(t *testing.T) {
		_, err := Compose(&recordingEndpoint{protocol: protocol.TypeAnthropicV1})
		check(t, err)
	})
	t.Run("compose stage", func(t *testing.T) {
		_, err := Compose(beta, &recordingStage{name: "s", protocol: protocol.TypeAnthropicV1})
		check(t, err)
	})
	t.Run("adapt bridge", func(t *testing.T) {
		_, err := Adapt(beta, &testingBridge{source: protocol.TypeAnthropicV1, target: protocol.TypeAnthropicBeta})
		check(t, err)
	})
	t.Run("adapt bridge target", func(t *testing.T) {
		_, err := Adapt(beta, &testingBridge{source: protocol.TypeAnthropicBeta, target: protocol.TypeAnthropicV1})
		check(t, err)
	})
}
