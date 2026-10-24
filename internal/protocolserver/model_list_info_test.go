package protocolserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/tingly-dev/tingly-box/internal/catalog"
	"github.com/tingly-dev/tingly-box/internal/config"
	"github.com/tingly-dev/tingly-box/internal/loadbalance"
	"github.com/tingly-dev/tingly-box/internal/protocol"
	"github.com/tingly-dev/tingly-box/internal/typ"
)

// Model details on /v1/models come from the catalog entry of the upstream
// model a rule routes to — even when the provider has a custom display name
// and the rule exposes an alias instead of the upstream model id.
func TestRuleModelInfo_MatchesByProviderAndUpstreamModel(t *testing.T) {
	cfg, err := config.NewConfig(config.WithConfigDir(t.TempDir()))
	require.NoError(t, err)
	tm := catalog.NewProviderCatalogManager(catalog.EmbeddedOnly())
	require.NoError(t, tm.Initialize(context.Background()))
	cfg.SetTemplateManager(tm)

	p := &typ.Provider{
		Name:     "my deepseek", // not a template id
		APIBase:  "https://api.deepseek.com/v1",
		APIStyle: protocol.APIStyleOpenAI,
		AuthType: typ.AuthTypeAPIKey,
		Token:    "sk-test",
		Enabled:  true,
	}
	require.NoError(t, cfg.AddProvider(p))

	rule := typ.Rule{
		RequestModel: "fast-thinker", // alias, not the upstream id
		Active:       true,
		Services: []*loadbalance.Service{
			{Provider: p.UUID, Model: "deepseek-reasoner", Active: true},
		},
	}
	info, ok := ruleModelInfo(cfg, rule)
	require.True(t, ok)
	assert.Equal(t, 128000, info.Context)
	assert.Equal(t, 64000, info.MaxOutput)

	// A rule that keeps the upstream name still resolves via the request model.
	rule.RequestModel = "deepseek-chat"
	rule.Services[0].Model = ""
	info, ok = ruleModelInfo(cfg, rule)
	require.True(t, ok)
	assert.Equal(t, 8000, info.MaxOutput)
}

// With several services, numeric fields are the smallest known across them,
// and /v1/models carries them under both our names and the OpenAI-compatible
// ones.
func TestRuleModelInfo_SmallestAcrossServices(t *testing.T) {
	cfg, err := config.NewConfig(config.WithConfigDir(t.TempDir()))
	require.NoError(t, err)
	tm := catalog.NewProviderCatalogManager(catalog.EmbeddedOnly())
	require.NoError(t, tm.Initialize(context.Background()))
	cfg.SetTemplateManager(tm)

	p := &typ.Provider{
		Name:     "ds",
		APIBase:  "https://api.deepseek.com/v1",
		APIStyle: protocol.APIStyleOpenAI,
		AuthType: typ.AuthTypeAPIKey,
		Token:    "sk-test",
		Enabled:  true,
	}
	require.NoError(t, cfg.AddProvider(p))
	reasoner, ok := tm.GetModelInfoForProvider(p, "deepseek-reasoner")
	require.True(t, ok)
	chat, ok := tm.GetModelInfoForProvider(p, "deepseek-chat")
	require.True(t, ok)

	rule := typ.Rule{
		RequestModel: "mixed",
		Active:       true,
		Services: []*loadbalance.Service{
			{Provider: p.UUID, Model: "deepseek-reasoner", Active: true},
			{Provider: p.UUID, Model: "deepseek-chat", Active: true},
			{Provider: p.UUID, Model: "not-in-catalog", Active: true},
		},
	}
	info, ok := ruleModelInfo(cfg, rule)
	require.True(t, ok)
	assert.Equal(t, min(reasoner.Context, chat.Context), info.Context)
	assert.Equal(t, min(reasoner.MaxOutput, chat.MaxOutput), info.MaxOutput)
	assert.Equal(t, reasoner.Description, info.Description, "description comes from the first known service")
}

// The Codex list says what each rule's Auto context window tells Codex:
// max_input_tokens is the route's input window (here the 1M flag opens a
// ChatGPT-backed model's 872K), max_context_window its ceiling when above it,
// and a model whose window would only be a guess carries neither. Other
// scenarios keep the catalog's input limit.
func TestCodexModelList_CarriesAutoWindow(t *testing.T) {
	cfg, err := config.NewConfig(config.WithConfigDir(t.TempDir()))
	require.NoError(t, err)
	tm := catalog.NewProviderCatalogManager(catalog.EmbeddedOnly())
	require.NoError(t, tm.Initialize(context.Background()))
	cfg.SetTemplateManager(tm)

	chatgpt := &typ.Provider{Name: "ChatGPT", APIBase: "https://chatgpt.com/backend-api", APIStyle: protocol.APIStyleOpenAI,
		AuthType: typ.AuthTypeOAuth, OAuthDetail: &typ.OAuthDetail{Issuer: "codex", AccessToken: "t"}, Enabled: true}
	house := &typ.Provider{Name: "House", APIBase: "https://llm.example.internal/v1", APIStyle: protocol.APIStyleOpenAI,
		AuthType: typ.AuthTypeAPIKey, Token: "k", Enabled: true}
	require.NoError(t, cfg.AddProvider(chatgpt))
	require.NoError(t, cfg.AddProvider(house))
	svc := func(p *typ.Provider, model string) []*loadbalance.Service {
		return []*loadbalance.Service{{Provider: p.UUID, Model: model, Active: true}}
	}
	cfg.Rules = []typ.Rule{
		{UUID: "a", Scenario: typ.ScenarioCodex, RequestModel: "sol", Active: true, Services: svc(chatgpt, "gpt-6-sol")},
		{UUID: "b", Scenario: typ.ScenarioCodex, RequestModel: "wide", Active: true, Services: svc(chatgpt, "gpt-6-sol"),
			Flags: typ.RuleFlags{Context1M: true}},
		{UUID: "c", Scenario: typ.ScenarioCodex, RequestModel: "house", Active: true, Services: svc(house, "house-model"),
			Flags: typ.RuleFlags{Context1M: true}},
		{UUID: "d", Scenario: typ.ScenarioOpenCode, RequestModel: "oc-sol", Active: true, Services: svc(chatgpt, "gpt-6-sol"),
			Flags: typ.RuleFlags{Context1M: true}},
	}
	ph := &ProtocolHandler{deps: ProtocolHandlerDeps{Config: cfg}}
	list := func(scenario typ.RuleScenario) map[string]OpenAIModel {
		gin.SetMode(gin.TestMode)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		ph.OpenAIListModelsForScenario(c, scenario)
		require.Equal(t, http.StatusOK, w.Code)
		var resp OpenAIModelsResponse
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
		out := map[string]OpenAIModel{}
		for _, m := range resp.Data {
			out[m.ID] = m
		}
		return out
	}

	codex := list(typ.ScenarioCodex)
	require.Len(t, codex, 3)
	assert.Equal(t, [3]int{272000, 272000, 872000}, [3]int{codex["sol"].ContextWindow, codex["sol"].MaxInputTokens, codex["sol"].MaxContextWindow})
	// The 1M flag opens more than the published window: context_window follows.
	assert.Equal(t, [3]int{872000, 872000, 0}, [3]int{codex["wide"].ContextWindow, codex["wide"].MaxInputTokens, codex["wide"].MaxContextWindow})
	assert.Equal(t, [3]int{0, 0, 0}, [3]int{codex["house"].ContextWindow, codex["house"].MaxInputTokens, codex["house"].MaxContextWindow})
	assert.Equal(t, "tingly-box", codex["sol"].OwnedBy)

	other := list(typ.ScenarioOpenCode)["oc-sol"]
	assert.Equal(t, [2]int{272000, 0}, [2]int{other.MaxInputTokens, other.MaxContextWindow})
}
