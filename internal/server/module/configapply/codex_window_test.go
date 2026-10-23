package configapply

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

// codexWindowConfig: one Codex rule on DeepSeek's deepseek-chat (128K in the
// embedded provider catalog) and one on a provider the catalog doesn't know.
func codexWindowConfig(t *testing.T) *config.Config {
	t.Helper()
	cfg, err := config.NewConfig(config.WithConfigDir(t.TempDir()))
	require.NoError(t, err)
	tm := catalog.NewProviderCatalogManager(catalog.EmbeddedOnly())
	require.NoError(t, tm.Initialize(context.Background()))
	cfg.SetTemplateManager(tm)

	ds := &typ.Provider{Name: "DeepSeek", APIBase: "https://api.deepseek.com/v1", APIStyle: protocol.APIStyleOpenAI, AuthType: typ.AuthTypeAPIKey, Token: "k", Enabled: true}
	house := &typ.Provider{Name: "House", APIBase: "https://llm.example.internal/v1", APIStyle: protocol.APIStyleOpenAI, AuthType: typ.AuthTypeAPIKey, Token: "k", Enabled: true}
	require.NoError(t, cfg.AddProvider(ds))
	require.NoError(t, cfg.AddProvider(house))
	cfg.Rules = []typ.Rule{
		{UUID: "r1", Scenario: typ.ScenarioCodex, RequestModel: "ds", Active: true,
			Services: []*loadbalance.Service{{Provider: ds.UUID, Model: "deepseek-chat", Active: true}}},
		{UUID: "r2", Scenario: typ.ScenarioCodex, RequestModel: "house", Active: true,
			Services: []*loadbalance.Service{{Provider: house.UUID, Model: "house-model", Active: true}}},
	}
	return cfg
}

func serve(t *testing.T, method, path string, h gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Handle(method, path, h)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(method, path, nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	return w
}

// GET /config/codex reports each catalog model's derived window and where
// it comes from, so the rule's Compact popover can show it.
func TestGetCodexConfig_ContextWindows(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	h := NewHandler(codexWindowConfig(t), "localhost")

	var resp CodexConfigResponse
	require.NoError(t, json.Unmarshal(serve(t, http.MethodGet, "/config/codex", h.GetCodexConfig).Body.Bytes(), &resp))
	assert.Equal(t, map[string]config.CodexContextWindow{
		"ds":    {Window: 128000, Source: config.CodexWindowSourceCatalog, Provider: "DeepSeek", Model: "deepseek-chat"},
		"house": {Window: 200000, Source: config.CodexWindowSourceDefault},
	}, resp.ContextWindows)
}

// Applying writes the derived windows into the catalog, and the status
// check agrees with what was written.
func TestApplyCodexConfig_WritesDerivedWindows(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	cfg := codexWindowConfig(t)
	h := NewHandler(cfg, "localhost")

	serve(t, http.MethodPost, "/config/apply/codex", h.ApplyCodexConfigFromState)

	raw, err := os.ReadFile(filepath.Join(home, ".codex", "tingly-model-catalog.json"))
	require.NoError(t, err)
	var catalogFile struct {
		Models []struct {
			Slug   string `json:"slug"`
			Window int    `json:"context_window"`
			Max    int    `json:"max_context_window"`
		} `json:"models"`
	}
	require.NoError(t, json.Unmarshal(raw, &catalogFile))
	got := map[string][2]int{}
	for _, m := range catalogFile.Models {
		got[m.Slug] = [2]int{m.Window, m.Max}
	}
	assert.Equal(t, map[string][2]int{"ds": {128000, 128000}, "house": {200000, 200000}}, got)

	var status ClientConfigStatusResponse
	require.NoError(t, json.Unmarshal(serve(t, http.MethodGet, "/config/codex/status", h.GetCodexConfigStatus).Body.Bytes(), &status))
	assert.Equal(t, ClientConfigApplied, status.State, "%v", status.Differences)

	// Pinning a window on the rule makes the applied catalog stale.
	cfg.Rules[0].Flags.CodexContextWindow = 100000
	require.NoError(t, json.Unmarshal(serve(t, http.MethodGet, "/config/codex/status", h.GetCodexConfigStatus).Body.Bytes(), &status))
	assert.Equal(t, ClientConfigOutdated, status.State)
}
