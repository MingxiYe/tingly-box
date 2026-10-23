package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	serverconfig "github.com/tingly-dev/tingly-box/internal/config"
	"github.com/tingly-dev/tingly-box/internal/loadbalance"
	"github.com/tingly-dev/tingly-box/internal/protocol"
	"github.com/tingly-dev/tingly-box/internal/typ"
)

// The CLI / IM apply writes the same per-model windows and compact overrides
// as the UI's Auto Config, not a flat 200K, even without the server's
// template manager.
func TestApplyAgent_CodexWritesDerivedWindows(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)

	cfg, err := serverconfig.NewConfig(serverconfig.WithConfigDir(t.TempDir()))
	require.NoError(t, err)
	// No SetTemplateManager: the CLI and TUI load the config like this, and
	// still get the windows from the embedded provider catalog.
	require.Nil(t, cfg.GetTemplateManager())
	ds := &typ.Provider{Name: "DeepSeek", APIBase: "https://api.deepseek.com/v1", APIStyle: protocol.APIStyleOpenAI, AuthType: typ.AuthTypeAPIKey, Token: "k", Enabled: true}
	require.NoError(t, cfg.AddProvider(ds))
	cfg.Rules = []typ.Rule{
		{UUID: "r1", Scenario: typ.ScenarioCodex, RequestModel: "ds", Active: true,
			Services: []*loadbalance.Service{{Provider: ds.UUID, Model: "deepseek-chat", Active: true}},
			Flags:    typ.RuleFlags{CodexCompactPercent: 60}},
		{UUID: "r2", Scenario: typ.ScenarioCodex, RequestModel: "pinned", Active: true,
			Services: []*loadbalance.Service{{Provider: ds.UUID, Model: "deepseek-chat", Active: true}},
			Flags:    typ.RuleFlags{CodexContextWindow: 64000}},
	}

	_, err = NewAgentApply(cfg, "127.0.0.1").ApplyAgent(&ApplyAgentRequest{AgentType: AgentTypeCodex})
	require.NoError(t, err)

	raw, err := os.ReadFile(filepath.Join(home, ".codex", "tingly-model-catalog.json"))
	require.NoError(t, err)
	var catalogFile struct {
		Models []struct {
			Slug    string `json:"slug"`
			Window  int    `json:"context_window"`
			Compact int    `json:"auto_compact_token_limit"`
		} `json:"models"`
	}
	require.NoError(t, json.Unmarshal(raw, &catalogFile))
	got := map[string][2]int{}
	for _, m := range catalogFile.Models {
		got[m.Slug] = [2]int{m.Window, m.Compact}
	}
	assert.Equal(t, map[string][2]int{
		"ds":     {128000, 76800}, // catalog window, the rule's 60%
		"pinned": {64000, 48000},  // the rule's own window, shared 75%
	}, got)
}
