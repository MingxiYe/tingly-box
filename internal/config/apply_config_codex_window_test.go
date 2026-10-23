package config

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tingly-dev/tingly-box/internal/catalog"
	"github.com/tingly-dev/tingly-box/internal/loadbalance"
	"github.com/tingly-dev/tingly-box/internal/protocol"
	"github.com/tingly-dev/tingly-box/internal/routing/smartrouting"
	"github.com/tingly-dev/tingly-box/internal/typ"
)

// codexWindowProviders are upstreams the embedded provider catalog knows (or
// deliberately doesn't), for the window resolver tests.
type codexWindowProviders struct {
	deepseek, deepseekAnthropic, anthropic, claudeCode, chatgpt, house, disabled, dual *typ.Provider
}

func newCodexWindowConfig(t *testing.T, withTemplateManager bool) (*Config, codexWindowProviders) {
	t.Helper()
	cfg, err := NewConfig(WithConfigDir(t.TempDir()))
	require.NoError(t, err)
	if withTemplateManager {
		tm := catalog.NewProviderCatalogManager(catalog.EmbeddedOnly())
		require.NoError(t, tm.Initialize(context.Background()))
		cfg.SetTemplateManager(tm)
	}
	key := func(name, base string, style protocol.APIStyle) *typ.Provider {
		return &typ.Provider{Name: name, APIBase: base, APIStyle: style, AuthType: typ.AuthTypeAPIKey, Token: "k", Enabled: true}
	}
	p := codexWindowProviders{
		deepseek:          key("DeepSeek", "https://api.deepseek.com/v1", protocol.APIStyleOpenAI),
		deepseekAnthropic: key("DeepSeek (Anthropic)", "https://api.deepseek.com/anthropic", protocol.APIStyleAnthropic),
		anthropic:         key("Anthropic", "https://api.anthropic.com", protocol.APIStyleAnthropic),
		house:             key("House", "https://llm.example.internal/v1", protocol.APIStyleOpenAI),
		disabled:          key("Old DeepSeek", "https://api.deepseek.com/v1", protocol.APIStyleOpenAI),
		dual:              key("Anthropic dual", "https://api.anthropic.com", protocol.APIStyleAnthropic),
		chatgpt: &typ.Provider{Name: "ChatGPT", APIBase: "https://chatgpt.com/backend-api", APIStyle: protocol.APIStyleOpenAI,
			AuthType: typ.AuthTypeOAuth, OAuthDetail: &typ.OAuthDetail{Issuer: "codex", AccessToken: "t"}, Enabled: true},
		claudeCode: &typ.Provider{Name: "Claude Code", APIBase: "https://api.anthropic.com", APIStyle: protocol.APIStyleAnthropic,
			AuthType: typ.AuthTypeOAuth, OAuthDetail: &typ.OAuthDetail{Issuer: "claude_code", AccessToken: "t"}, Enabled: true},
	}
	p.dual.APIBaseOpenAI = "https://api.anthropic.com/v1/openai"
	p.dual.APIBaseAnthropic = "https://api.anthropic.com"
	for _, prov := range []*typ.Provider{p.deepseek, p.deepseekAnthropic, p.anthropic, p.claudeCode, p.chatgpt, p.house, p.disabled, p.dual} {
		require.NoError(t, cfg.AddProvider(prov))
	}
	// The store creates providers enabled; switch this one off afterwards.
	p.disabled.Enabled = false
	require.NoError(t, cfg.UpdateProvider(p.disabled.UUID, p.disabled))
	got, err := cfg.GetProviderByUUID(p.disabled.UUID)
	require.NoError(t, err)
	require.False(t, got.Enabled)
	return cfg, p
}

func codexSvc(provider *typ.Provider, model string) *loadbalance.Service {
	return &loadbalance.Service{Provider: provider.UUID, Model: model, Active: true}
}

func codexRule(model string, flags typ.RuleFlags, services ...*loadbalance.Service) typ.Rule {
	return typ.Rule{UUID: "r-" + model, Scenario: typ.ScenarioCodex, RequestModel: model, Active: true, Flags: flags, Services: services}
}

// Each kind of upstream contributes the window it really answers with, and
// the 1M flag only matters where it opens the window (Claude on an
// Anthropic-style endpoint, or a model nothing is known about).
func TestCodexAutoContextWindow_PerUpstream(t *testing.T) {
	cfg, p := newCodexWindowConfig(t, true)
	on := typ.RuleFlags{Context1M: true}
	off := typ.RuleFlags{}

	tests := []struct {
		name string
		rule typ.Rule
		want CodexContextWindow
	}{
		{"catalog model", codexRule("ds", off, codexSvc(p.deepseek, "deepseek-chat")),
			CodexContextWindow{Window: 128000, Max: 128000, Source: CodexWindowSourceCatalog, Provider: "DeepSeek", Model: "deepseek-chat"}},
		{"1M flag doesn't widen a known non-Claude model", codexRule("ds", on, codexSvc(p.deepseek, "deepseek-chat")),
			CodexContextWindow{Window: 128000, Max: 128000, Source: CodexWindowSourceCatalog, Provider: "DeepSeek", Model: "deepseek-chat"}},
		{"non-Claude model behind an Anthropic-style endpoint keeps its window", codexRule("ds", on, codexSvc(p.deepseekAnthropic, "deepseek-chat")),
			CodexContextWindow{Window: 128000, Max: 128000, Source: CodexWindowSourceCatalog, Provider: "DeepSeek (Anthropic)", Model: "deepseek-chat"}},
		{"1M model on DeepSeek", codexRule("flash", off, codexSvc(p.deepseek, "deepseek-v4-flash")),
			CodexContextWindow{Window: 1000000, Max: 1000000, Source: CodexWindowSourceCatalog, Provider: "DeepSeek", Model: "deepseek-v4-flash"}},
		{"Claude on Anthropic without 1M answers with 200K", codexRule("sonnet", off, codexSvc(p.anthropic, "claude-sonnet-4-6")),
			CodexContextWindow{Window: 200000, Max: 200000, Source: CodexWindowSourceAnthropic, Provider: "Anthropic", Model: "claude-sonnet-4-6"}},
		{"Claude on Anthropic with 1M", codexRule("sonnet", on, codexSvc(p.anthropic, "claude-sonnet-4-6")),
			CodexContextWindow{Window: 1000000, Max: 1000000, Source: CodexWindowSource1M, Provider: "Anthropic", Model: "claude-sonnet-4-6"}},
		{"Claude whose catalog window is 200K stays catalog", codexRule("sonnet", off, codexSvc(p.claudeCode, "claude-sonnet-4-5")),
			CodexContextWindow{Window: 200000, Max: 200000, Source: CodexWindowSourceCatalog, Provider: "Claude Code", Model: "claude-sonnet-4-5"}},
		{"Claude subscription with 1M", codexRule("opus", on, codexSvc(p.claudeCode, "claude-opus-4-6")),
			CodexContextWindow{Window: 1000000, Max: 1000000, Source: CodexWindowSource1M, Provider: "Claude Code", Model: "claude-opus-4-6"}},
		{"Claude reached over a dual provider's OpenAI URL keeps its catalog window", codexRule("sonnet", off, codexSvc(p.dual, "claude-sonnet-4-6")),
			CodexContextWindow{Window: 1000000, Max: 1000000, Source: CodexWindowSourceCatalog, Provider: "Anthropic dual", Model: "claude-sonnet-4-6"}},
		{"forcing the Anthropic endpoint brings the header rule back", codexRule("sonnet", typ.RuleFlags{AnthropicEndpointOverride: "anthropic"}, codexSvc(p.dual, "claude-sonnet-4-6")),
			CodexContextWindow{Window: 200000, Max: 200000, Source: CodexWindowSourceAnthropic, Provider: "Anthropic dual", Model: "claude-sonnet-4-6"}},
		{"ChatGPT-backed model: 272K, up to 872K", codexRule("sol", off, codexSvc(p.chatgpt, "gpt-6-sol")),
			CodexContextWindow{Window: 272000, Max: 872000, Source: CodexWindowSourceCatalog, Provider: "ChatGPT", Model: "gpt-6-sol"}},
		{"ChatGPT-backed model ignores the 1M flag (#2131)", codexRule("sol", on, codexSvc(p.chatgpt, "gpt-6-sol")),
			CodexContextWindow{Window: 272000, Max: 872000, Source: CodexWindowSourceCatalog, Provider: "ChatGPT", Model: "gpt-6-sol"}},
		{"unknown model", codexRule("house", off, codexSvc(p.house, "house-model")),
			CodexContextWindow{Window: 200000, Max: 200000, Source: CodexWindowSourceDefault, Provider: "House", Model: "house-model"}},
		{"unknown model keeps the old 1M meaning", codexRule("house", on, codexSvc(p.house, "house-model")),
			CodexContextWindow{Window: 1000000, Max: 1000000, Source: CodexWindowSource1M, Provider: "House", Model: "house-model"}},
		{"service without a model sends the request model upstream", codexRule("deepseek-chat", off, codexSvc(p.deepseek, "")),
			CodexContextWindow{Window: 128000, Max: 128000, Source: CodexWindowSourceCatalog, Provider: "DeepSeek", Model: "deepseek-chat"}},
		{"request model is looked up when the service model is unknown", codexRule("deepseek-reasoner", off, codexSvc(p.deepseek, "ds-custom")),
			CodexContextWindow{Window: 128000, Max: 128000, Source: CodexWindowSourceCatalog, Provider: "DeepSeek", Model: "deepseek-reasoner"}},
		{"no services", codexRule("empty", off),
			CodexContextWindow{Window: 200000, Max: 200000, Source: CodexWindowSourceDefault}},
		{"no services with 1M", codexRule("empty", on),
			CodexContextWindow{Window: 1000000, Max: 1000000, Source: CodexWindowSource1M}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, cfg.CodexAutoContextWindow(tt.rule))
		})
	}
}

// A rule that can reach several upstreams gets the smallest window and the
// smallest ceiling; upstreams that never answer don't count.
func TestCodexAutoContextWindow_SmallestReachable(t *testing.T) {
	cfg, p := newCodexWindowConfig(t, true)

	// Load-balanced: the 128K model decides the window, the ChatGPT model's
	// 872K ceiling doesn't survive the 128K one.
	rule := codexRule("mix", typ.RuleFlags{}, codexSvc(p.chatgpt, "gpt-6-sol"), codexSvc(p.deepseek, "deepseek-chat"), codexSvc(p.deepseek, "deepseek-v4-flash"))
	assert.Equal(t, CodexContextWindow{Window: 128000, Max: 128000, Source: CodexWindowSourceCatalog, Provider: "DeepSeek", Model: "deepseek-chat"},
		cfg.CodexAutoContextWindow(rule))

	// The smallest window and the smallest ceiling can come from different
	// upstreams: 272K/872K and 1M/1M give 272K/872K.
	rule = codexRule("mix", typ.RuleFlags{}, codexSvc(p.deepseek, "deepseek-v4-flash"), codexSvc(p.chatgpt, "gpt-6-sol"))
	assert.Equal(t, CodexContextWindow{Window: 272000, Max: 872000, Source: CodexWindowSourceCatalog, Provider: "ChatGPT", Model: "gpt-6-sol"},
		cfg.CodexAutoContextWindow(rule))

	// Inactive services, disabled providers and deleted providers never answer.
	inactive := codexSvc(p.deepseek, "deepseek-chat")
	inactive.Active = false
	rule = codexRule("flash", typ.RuleFlags{},
		codexSvc(p.deepseek, "deepseek-v4-flash"), inactive,
		codexSvc(p.disabled, "deepseek-chat"),
		&loadbalance.Service{Provider: "deleted-provider", Model: "deepseek-chat", Active: true}, nil)
	assert.Equal(t, CodexContextWindow{Window: 1000000, Max: 1000000, Source: CodexWindowSourceCatalog, Provider: "DeepSeek", Model: "deepseek-v4-flash"},
		cfg.CodexAutoContextWindow(rule))

	// Only unreachable upstreams: judged like an unknown model.
	rule = codexRule("gone", typ.RuleFlags{}, codexSvc(p.disabled, "deepseek-chat"))
	assert.Equal(t, CodexContextWindow{Window: 200000, Max: 200000, Source: CodexWindowSourceDefault}, cfg.CodexAutoContextWindow(rule))
}

// With smart routing on, every route's services count too; off, they don't.
func TestCodexAutoContextWindow_SmartRoutes(t *testing.T) {
	cfg, p := newCodexWindowConfig(t, true)
	rule := codexRule("smart", typ.RuleFlags{}, codexSvc(p.deepseek, "deepseek-v4-flash"))
	rule.SmartRouting = []smartrouting.SmartRouting{{Description: "short", Services: []*loadbalance.Service{codexSvc(p.deepseek, "deepseek-chat")}}}

	assert.Equal(t, 1000000, cfg.CodexAutoContextWindow(rule).Window, "routes are ignored while smart routing is off")
	rule.SmartEnabled = true
	assert.Equal(t, CodexContextWindow{Window: 128000, Max: 128000, Source: CodexWindowSourceCatalog, Provider: "DeepSeek", Model: "deepseek-chat"},
		cfg.CodexAutoContextWindow(rule))
}

// A config loaded without the server's template manager (CLI, TUI) falls back
// to the embedded catalog and derives the same windows.
func TestCodexAutoContextWindow_EmbeddedCatalogFallback(t *testing.T) {
	cfg, p := newCodexWindowConfig(t, false)
	require.Nil(t, cfg.GetTemplateManager())
	assert.Equal(t, CodexContextWindow{Window: 272000, Max: 872000, Source: CodexWindowSourceCatalog, Provider: "ChatGPT", Model: "gpt-6-sol"},
		cfg.CodexAutoContextWindow(codexRule("sol", typ.RuleFlags{}, codexSvc(p.chatgpt, "gpt-6-sol"))))
}

// The rule's own window wins; the derived ceiling stays when it is higher so
// Codex's model_context_window can still reach it, and an own window above
// the ceiling becomes the ceiling.
func TestCodexContextWindowFor_OwnWindow(t *testing.T) {
	cfg, p := newCodexWindowConfig(t, true)
	sol := codexSvc(p.chatgpt, "gpt-6-sol")

	assert.Equal(t, CodexContextWindow{Window: 128000, Max: 128000, Source: CodexWindowSourceRule},
		cfg.CodexContextWindowFor(codexRule("sol", typ.RuleFlags{CodexContextWindow: 128000}, sol)))
	// Also on a model the catalog doesn't know: the default ceiling is a guess.
	house := codexSvc(p.house, "house-model")
	assert.Equal(t, CodexContextWindow{Window: 128000, Max: 128000, Source: CodexWindowSourceRule},
		cfg.CodexContextWindowFor(codexRule("house", typ.RuleFlags{CodexContextWindow: 128000, Context1M: true}, house)))
	assert.Equal(t, CodexContextWindow{Window: 1000000, Max: 1000000, Source: CodexWindowSourceRule},
		cfg.CodexContextWindowFor(codexRule("sol", typ.RuleFlags{CodexContextWindow: 1000000}, sol)))
	// Out of range is ignored.
	assert.Equal(t, CodexContextWindow{Window: 272000, Max: 872000, Source: CodexWindowSourceCatalog, Provider: "ChatGPT", Model: "gpt-6-sol"},
		cfg.CodexContextWindowFor(codexRule("sol", typ.RuleFlags{CodexContextWindow: 100}, sol)))
}

// The maps the catalog renderer and the status check read: default windows are
// left out, ceilings only appear above the window, inactive and non-Codex
// rules are skipped, and two rules sharing a request model keep the smaller.
func TestBuildContextWindowsFromRules_Maps(t *testing.T) {
	cfg, p := newCodexWindowConfig(t, true)
	inactive := codexRule("inactive", typ.RuleFlags{}, codexSvc(p.deepseek, "deepseek-chat"))
	inactive.Active = false
	claude := codexRule("cc-model", typ.RuleFlags{}, codexSvc(p.deepseek, "deepseek-chat"))
	claude.Scenario = typ.ScenarioClaudeCode
	twin := codexRule("shared", typ.RuleFlags{}, codexSvc(p.deepseek, "deepseek-chat"))
	twin.UUID = "r-shared-2"
	cfg.Rules = []typ.Rule{
		codexRule("sol", typ.RuleFlags{}, codexSvc(p.chatgpt, "gpt-6-sol")),
		codexRule("ds", typ.RuleFlags{Context1M: true}, codexSvc(p.deepseek, "deepseek-chat")),
		codexRule("house", typ.RuleFlags{}, codexSvc(p.house, "house-model")),
		codexRule(" padded ", typ.RuleFlags{}, codexSvc(p.deepseek, "deepseek-v4-flash")),
		codexRule("shared", typ.RuleFlags{}, codexSvc(p.deepseek, "deepseek-v4-flash")),
		twin, inactive, claude,
	}

	assert.Equal(t, map[string]int{"sol": 272000, "ds": 128000, "padded": 1000000, "shared": 128000}, BuildContextWindowsFromRules(cfg))
	assert.Equal(t, map[string]int{"sol": 872000}, BuildMaxContextWindowsFromRules(cfg))
	assert.Equal(t, CodexContextWindow{Window: 200000, Max: 200000, Source: CodexWindowSourceDefault, Provider: "House", Model: "house-model"},
		ResolveCodexContextWindows(cfg)["house"])
	assert.Empty(t, ResolveCodexContextWindows(nil))
}

// The rendered catalog carries the window and the ceiling separately.
func TestRenderCodexModelCatalog_MaxContextWindow(t *testing.T) {
	prefs := DefaultCodexPrefs()
	prefs.ModelMaxContextWindow = map[string]int{"sol": 872000, "low": 100000}
	raw, err := RenderCodexModelCatalogWithPrefs([]string{"sol", "ds", "low", "plain"},
		map[string]int{"sol": 272000, "ds": 128000, "low": 128000}, prefs)
	require.NoError(t, err)
	got := map[string][3]int{}
	for _, m := range decodeCodexCatalog(t, raw) {
		got[m.Slug] = [3]int{m.ContextWindow, m.MaxContextWindow, m.AutoCompactTokenLimit}
	}
	assert.Equal(t, map[string][3]int{
		"sol":   {272000, 872000, 204000},
		"ds":    {128000, 128000, 96000},
		"low":   {128000, 128000, 96000}, // a ceiling below the window is ignored
		"plain": {200000, 200000, 150000},
	}, got)
}

type codexCatalogEntry struct {
	Slug                  string `json:"slug"`
	ContextWindow         int    `json:"context_window"`
	MaxContextWindow      int    `json:"max_context_window"`
	AutoCompactTokenLimit int    `json:"auto_compact_token_limit"`
}

func decodeCodexCatalog(t *testing.T, raw []byte) []codexCatalogEntry {
	t.Helper()
	var c struct {
		Models []codexCatalogEntry `json:"models"`
	}
	require.NoError(t, json.Unmarshal(raw, &c))
	return c.Models
}
