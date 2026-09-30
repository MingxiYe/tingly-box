package configapply

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCompareClaudeCodeEnv(t *testing.T) {
	expected := map[string]string{
		"ANTHROPIC_BASE_URL":             "http://127.0.0.1:12580/tingly/claude_code",
		"ANTHROPIC_AUTH_TOKEN":           "tingly-box-abcdefghijklmnop",
		"ANTHROPIC_MODEL":                "claude-sonnet-5",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL":  "claude-sonnet-5",
		"ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-5",
		"ANTHROPIC_DEFAULT_OPUS_MODEL":   "claude-sonnet-5",
		"CLAUDE_CODE_SUBAGENT_MODEL":     "claude-sonnet-5",
	}
	clone := func(over map[string]string) map[string]string {
		m := map[string]string{}
		for k, v := range expected {
			m[k] = v
		}
		// Reached through a different host than the server's own — not a difference.
		m["ANTHROPIC_BASE_URL"] = "http://localhost:12580/tingly/claude_code"
		for k, v := range over {
			m[k] = v
		}
		return m
	}

	state, diffs := compareClaudeCodeEnv(false, nil, expected)
	assert.Equal(t, ClientConfigNotApplied, state)
	assert.Empty(t, diffs)

	state, _ = compareClaudeCodeEnv(true, map[string]string{"ANTHROPIC_BASE_URL": "https://api.anthropic.com"}, expected)
	assert.Equal(t, ClientConfigNotApplied, state, "a settings.json that doesn't route through the gateway")

	state, diffs = compareClaudeCodeEnv(true, clone(nil), expected)
	assert.Equal(t, ClientConfigApplied, state)
	assert.Empty(t, diffs)

	// Switched to 1M after applying: the slot gained a [1m] suffix.
	state, diffs = compareClaudeCodeEnv(true, clone(map[string]string{
		"ANTHROPIC_MODEL":      "claude-sonnet-5",
		"ANTHROPIC_AUTH_TOKEN": "tingly-box-OLDOLDOLDOLDOLD",
	}), map[string]string{
		"ANTHROPIC_AUTH_TOKEN":           expected["ANTHROPIC_AUTH_TOKEN"],
		"ANTHROPIC_MODEL":                "claude-sonnet-5[1m]",
		"ANTHROPIC_DEFAULT_HAIKU_MODEL":  "claude-sonnet-5",
		"ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-5",
		"ANTHROPIC_DEFAULT_OPUS_MODEL":   "claude-sonnet-5",
		"CLAUDE_CODE_SUBAGENT_MODEL":     "claude-sonnet-5",
	})
	assert.Equal(t, ClientConfigOutdated, state)
	assert.Equal(t, []ClientConfigDifference{
		{Key: "ANTHROPIC_AUTH_TOKEN", Applied: "tingly-b…DOLD", Expected: "tingly-b…mnop"},
		{Key: "ANTHROPIC_MODEL", Applied: "claude-sonnet-5", Expected: "claude-sonnet-5[1m]"},
	}, diffs)
}
