package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tingly-dev/tingly-box/internal/loadbalance"
	"github.com/tingly-dev/tingly-box/internal/routing/smartrouting"
	"github.com/tingly-dev/tingly-box/internal/typ"
)

// RuleModelInfo reads every upstream a rule can reach, the same ones the Codex
// window does: smart routes count while smart routing is on, services on a
// disabled or deleted provider never answer.
func TestRuleModelInfo_ReachableUpstreams(t *testing.T) {
	cfg, p := newCodexWindowConfig(t, true)

	rule := codexRule("smart", typ.RuleFlags{}, codexSvc(p.deepseek, "deepseek-v4-flash"))
	rule.SmartRouting = []smartrouting.SmartRouting{{Description: "short", Services: []*loadbalance.Service{codexSvc(p.deepseek, "deepseek-chat")}}}
	info, ok := cfg.RuleModelInfo(rule)
	require.True(t, ok)
	assert.Equal(t, 1000000, info.Context, "routes are ignored while smart routing is off")
	rule.SmartEnabled = true
	info, _ = cfg.RuleModelInfo(rule)
	assert.Equal(t, 128000, info.Context)

	rule = codexRule("gone", typ.RuleFlags{}, codexSvc(p.deepseek, "deepseek-v4-flash"), codexSvc(p.disabled, "deepseek-chat"),
		&loadbalance.Service{Provider: "deleted-provider", Model: "deepseek-chat", Active: true})
	info, _ = cfg.RuleModelInfo(rule)
	assert.Equal(t, 1000000, info.Context)

	_, ok = cfg.RuleModelInfo(codexRule("off", typ.RuleFlags{}, codexSvc(p.disabled, "deepseek-chat")))
	assert.False(t, ok)
}

// The larger opt-in window is kept for one upstream only: templates count it
// differently (OpenAI's includes output), so a merge would mix units. The
// Codex window merges it per upstream instead.
func TestRuleModelInfo_MaxContextFromOneUpstream(t *testing.T) {
	cfg, p := newCodexWindowConfig(t, true)

	info, ok := cfg.RuleModelInfo(codexRule("sol", typ.RuleFlags{}, codexSvc(p.chatgpt, "gpt-6-sol")))
	require.True(t, ok)
	assert.Equal(t, [2]int{272000, 872000}, [2]int{info.Context, info.MaxContext})

	// Either order: the upstream with the larger window may be read first.
	for _, mix := range []typ.Rule{
		codexRule("mix", typ.RuleFlags{}, codexSvc(p.openai, "gpt-5.4-mini"), codexSvc(p.chatgpt, "gpt-6-sol")),
		codexRule("mix", typ.RuleFlags{}, codexSvc(p.chatgpt, "gpt-6-sol"), codexSvc(p.openai, "gpt-5.4-mini")),
	} {
		info, _ = cfg.RuleModelInfo(mix)
		assert.Equal(t, [3]int{272000, 272000, 0}, [3]int{info.Context, info.InputLimit(), info.MaxContext})
		assert.Equal(t, CodexContextWindow{Window: 272000, Max: 272000, Source: CodexWindowSourceCatalog}, cfg.CodexAutoContextWindow(mix))
	}
}
