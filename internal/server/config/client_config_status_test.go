package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCompareCodexConfig(t *testing.T) {
	applied := CodexAppliedState{
		Managed:        true,
		BaseURL:        "http://localhost:12580/tingly/codex",
		Model:          "gpt-5.6-luna",
		CatalogModels:  []string{"gpt-5.6-luna", "gpt-5.6-terra"},
		ContextWindows: map[string]int{"gpt-5.6-luna": codexDefaultContextWindow, "gpt-5.6-terra": codexDefaultContextWindow},
	}

	state, diffs := CompareCodexConfig(applied, []string{"gpt-5.6-luna", "gpt-5.6-terra"}, nil)
	assert.Equal(t, ClientConfigApplied, state)
	assert.Empty(t, diffs)

	// A rule was added and luna switched to 1M after the last apply.
	state, diffs = CompareCodexConfig(applied, []string{"gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"}, map[string]int{"gpt-5.6-luna": 1000000})
	assert.Equal(t, ClientConfigOutdated, state)
	assert.Equal(t, []ClientConfigDiff{
		{Key: "models", Applied: "gpt-5.6-luna, gpt-5.6-terra", Expected: "gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra"},
		{Key: "context_window[gpt-5.6-luna]", Applied: "200000", Expected: "1000000"},
	}, diffs)

	state, _ = CompareCodexConfig(CodexAppliedState{}, []string{"x"}, nil)
	assert.Equal(t, ClientConfigNotApplied, state)
	state, _ = CompareCodexConfig(CodexAppliedState{Managed: true, BaseURL: "https://api.openai.com/v1"}, []string{"x"}, nil)
	assert.Equal(t, ClientConfigNotApplied, state)
}

func TestCompareDshConfig(t *testing.T) {
	applied := DshAppliedState{Managed: true, BaseURL: "http://127.0.0.1:12580/tingly/dsh", Models: []string{"deepseek-v4-pro"}}

	state, diffs := CompareDshConfig(applied, []string{"deepseek-v4-pro"})
	assert.Equal(t, ClientConfigApplied, state)
	assert.Empty(t, diffs)

	state, diffs = CompareDshConfig(applied, []string{"deepseek-v4-pro", "deepseek-v4-flash"})
	assert.Equal(t, ClientConfigOutdated, state)
	assert.Equal(t, "deepseek-v4-flash, deepseek-v4-pro", diffs[0].Expected)

	state, _ = CompareDshConfig(DshAppliedState{}, []string{"x"})
	assert.Equal(t, ClientConfigNotApplied, state)
}

// The reader must agree with the writer: applying and reading back is "applied".
func TestCodexStatusRoundTrip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	models := []string{"gpt-5.6-luna", "gpt-5.6-terra"}
	windows := map[string]int{"gpt-5.6-terra": 1000000}

	_, err := ApplyCodexConfigWithContextWindows("http://localhost:12580/tingly/codex", models, DefaultCodexPrefs(), true, windows, "")
	assert.NoError(t, err)
	applied, err := ReadCodexAppliedState()
	assert.NoError(t, err)

	state, diffs := CompareCodexConfig(applied, models, windows)
	assert.Equal(t, ClientConfigApplied, state, "%v", diffs)
	state, _ = CompareCodexConfig(applied, models, nil)
	assert.Equal(t, ClientConfigOutdated, state, "dropping 1M on terra must show up")
}

func TestDshStatusRoundTrip(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("DSH_HOME", home)
	models := []string{"deepseek-v4-pro"}

	_, err := ApplyDshSettings("http://localhost:12580/tingly/dsh", models, DefaultDshPrefs())
	assert.NoError(t, err)
	applied, err := ReadDshAppliedState()
	assert.NoError(t, err)

	state, diffs := CompareDshConfig(applied, models)
	assert.Equal(t, ClientConfigApplied, state, "%v", diffs)
}
