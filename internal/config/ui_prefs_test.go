package config

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPatchUIPrefs(t *testing.T) {
	dir := t.TempDir()
	cfg, err := NewConfigWithDir(dir, WithDisableMigration())
	require.NoError(t, err)

	got, err := cfg.PatchUIPrefs(map[string]json.RawMessage{
		"scenario.hidden":   json.RawMessage(`["pi","cursor"]`),
		"setup.claude_code": json.RawMessage(`{"installed":true}`),
	})
	require.NoError(t, err)
	assert.JSONEq(t, `["pi","cursor"]`, string(got["scenario.hidden"]))

	// null deletes; other keys are untouched.
	got, err = cfg.PatchUIPrefs(map[string]json.RawMessage{"setup.claude_code": json.RawMessage(`null`)})
	require.NoError(t, err)
	assert.NotContains(t, got, "setup.claude_code")
	assert.Contains(t, got, "scenario.hidden")

	// Survives a reload from disk.
	reloaded, err := NewConfigWithDir(dir, WithDisableMigration())
	require.NoError(t, err)
	assert.JSONEq(t, `["pi","cursor"]`, string(reloaded.GetUIPrefs()["scenario.hidden"]))
}

func TestPatchUIPrefsClearingAllSticks(t *testing.T) {
	// Save() keeps file keys missing from the marshalled config; an emptied
	// map must still overwrite the old value on disk.
	dir := t.TempDir()
	cfg, err := NewConfigWithDir(dir, WithDisableMigration())
	require.NoError(t, err)
	_, err = cfg.PatchUIPrefs(map[string]json.RawMessage{"k": json.RawMessage(`1`)})
	require.NoError(t, err)
	_, err = cfg.PatchUIPrefs(map[string]json.RawMessage{"k": json.RawMessage(`null`)})
	require.NoError(t, err)

	reloaded, err := NewConfigWithDir(dir, WithDisableMigration())
	require.NoError(t, err)
	assert.Empty(t, reloaded.GetUIPrefs())
}

func TestPatchUIPrefsRejectsBadInput(t *testing.T) {
	cfg, err := NewConfigWithDir(t.TempDir(), WithDisableMigration())
	require.NoError(t, err)

	_, err = cfg.PatchUIPrefs(map[string]json.RawMessage{"": json.RawMessage(`1`)})
	assert.Error(t, err)

	big := make([]byte, MaxUIPrefValueBytes+3)
	big[0] = '"'
	for i := 1; i < len(big)-1; i++ {
		big[i] = 'x'
	}
	big[len(big)-1] = '"'
	_, err = cfg.PatchUIPrefs(map[string]json.RawMessage{"k": big})
	assert.Error(t, err)
	assert.Empty(t, cfg.GetUIPrefs(), "a rejected patch must not apply partially")
}
