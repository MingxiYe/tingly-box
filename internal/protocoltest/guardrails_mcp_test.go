package protocoltest

import "testing"

// Guardrails x MCP composition through the real HTTP gateway. The case
// bodies live in servertool.go and also run in the harness CLI
// (--mode=servertool); known gaps are registered in known_gaps.go under
// these test names.

// TestGuardrailsBlocksServerTool pins that a server-owned tool call blocked
// by guardrails is not executed and the client gets the block message.
func TestGuardrailsBlocksServerTool(t *testing.T) {
	runServerToolTest(t, "TestGuardrailsBlocksServerTool")
}

// TestGuardrailsBlocksClientToolAfterServerRound pins that the client tool
// the model calls after a server round is still checked and blocked.
func TestGuardrailsBlocksClientToolAfterServerRound(t *testing.T) {
	runServerToolTest(t, "TestGuardrailsBlocksClientToolAfterServerRound")
}

// TestGuardrailsCredentialAliasClientTool pins that response checks see the
// model's masked output (not the restored secret) and that the client's tool
// input carries the real credential.
func TestGuardrailsCredentialAliasClientTool(t *testing.T) {
	runServerToolTest(t, "TestGuardrailsCredentialAliasClientTool")
}
