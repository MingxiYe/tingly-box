// Package stage defines transport-independent protocol endpoints, ordered
// same-protocol stages, and the bidirectional bridges between protocols.
//
// Provider endpoints, Guardrails and the server tool loop become composable
// levels, and protocol changes happen only in an explicit Bridge. Nothing in
// the server imports this package yet.
//
// Anthropic V1 is not a chain protocol. V1 is a subset of Anthropic Beta on the
// wire, so V1 requests are upgraded to Beta at the client edge and downgraded
// only where a provider needs the V1 path; every Endpoint, Stage and Bridge in
// a chain speaks anthropic_beta for Anthropic. The contracts enforce this.
//
// Terminal provider endpoints live in stage/upstream; the cross-protocol
// bridges from Anthropic Beta to the OpenAI protocols live in
// stage/anthropicbridge.
package stage
