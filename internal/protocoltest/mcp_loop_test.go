package protocoltest

import "testing"

// Server-owned tool loop through the real HTTP gateway. The case bodies live
// in servertool.go and also run in the harness CLI (--mode=servertool); known
// gaps are registered in known_gaps.go under these test names.

// TestMCPOwnedToolLoop pins the server-owned tool loop for every protocol
// pair: the tool is executed once with the model's arguments and only the
// final answer reaches the client.
func TestMCPOwnedToolLoop(t *testing.T) { runServerToolTest(t, "TestMCPOwnedToolLoop") }

// TestMCPOwnedToolNotOfferedWhenDisabled pins that without the MCP extension
// the gateway neither offers nor executes server tools.
func TestMCPOwnedToolNotOfferedWhenDisabled(t *testing.T) {
	runServerToolTest(t, "TestMCPOwnedToolNotOfferedWhenDisabled")
}

// TestMCPServerToolError pins that a failing server tool is reported back to
// the model rather than aborting the request, and is not retried.
func TestMCPServerToolError(t *testing.T) { runServerToolTest(t, "TestMCPServerToolError") }

// TestMCPToolLoopBounded pins the round limit: a model that keeps calling a
// server tool cannot hold the request forever.
func TestMCPToolLoopBounded(t *testing.T) { runServerToolTest(t, "TestMCPToolLoopBounded") }

// TestMCPMixedToolContinuation pins the two-request mixed round (server tool
// hidden, client tool returned, stored server result spliced back in).
func TestMCPMixedToolContinuation(t *testing.T) { runServerToolTest(t, "TestMCPMixedToolContinuation") }

// TestMCPTruncatedToolStream pins that a provider stream cut inside a server
// tool call neither executes nor leaks the call, and fails the request.
func TestMCPTruncatedToolStream(t *testing.T) { runServerToolTest(t, "TestMCPTruncatedToolStream") }

// TestMCPToolInputOnBlockStart pins that a server tool call whose input is
// complete on content_block_start runs once with that input.
func TestMCPToolInputOnBlockStart(t *testing.T) { runServerToolTest(t, "TestMCPToolInputOnBlockStart") }

// TestMCPNoFailoverAfterServerTool pins that a retryable failure after a
// server tool ran does not fail over to another service.
func TestMCPNoFailoverAfterServerTool(t *testing.T) {
	runServerToolTest(t, "TestMCPNoFailoverAfterServerTool")
}
