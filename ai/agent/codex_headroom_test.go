package agent

import (
	"encoding/json"
	"testing"
)

// The ai/agent copy of the catalog renderer must honor the same headroom
// prefs as internal/config (the two copies are intentionally duplicated).
func TestRenderCodexModelCatalogWithPrefs_Headroom(t *testing.T) {
	render := func(p *CodexPrefs) (effective, compact, window int) {
		raw, err := RenderCodexModelCatalogWithPrefs([]string{"m"}, nil, p)
		if err != nil {
			t.Fatal(err)
		}
		var c struct {
			Models []struct {
				ContextWindow int `json:"context_window"`
				Compact       int `json:"auto_compact_token_limit"`
				Effective     int `json:"effective_context_window_percent"`
			} `json:"models"`
		}
		if err := json.Unmarshal(raw, &c); err != nil {
			t.Fatal(err)
		}
		m := c.Models[0]
		return m.Effective, m.Compact, m.ContextWindow
	}

	if e, c, w := render(nil); e != 82 || c != w*75/100 {
		t.Errorf("defaults: effective=%d compact=%d window=%d", e, c, w)
	}
	if e, c, w := render(&CodexPrefs{EffectiveContextWindowPercent: "90", AutoCompactPercent: "70"}); e != 90 || c != w*70/100 {
		t.Errorf("custom: effective=%d compact=%d window=%d", e, c, w)
	}
	if e, c, w := render(&CodexPrefs{EffectiveContextWindowPercent: "60", AutoCompactPercent: "95"}); e != 60 || c != w*60/100 {
		t.Errorf("clamp: effective=%d compact=%d window=%d", e, c, w)
	}
}

// Per-model compact overrides follow each model's own window and stay under
// the usable window.
func TestRenderCodexModelCatalogWithPrefs_PerModelCompact(t *testing.T) {
	prefs := DefaultCodexPrefs()
	prefs.ModelAutoCompactPercent = map[string]int{"a": 60, "b": 95, "c": 10}
	raw, err := RenderCodexModelCatalogWithPrefs([]string{"a", "b", "c", "d"}, map[string]int{"a": 128000, "b": 256000}, prefs)
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Models []struct {
			Slug    string `json:"slug"`
			Window  int    `json:"context_window"`
			Max     int    `json:"max_context_window"`
			Compact int    `json:"auto_compact_token_limit"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &catalog); err != nil {
		t.Fatal(err)
	}
	want := map[string][3]int{
		"a": {128000, 128000, 76800},  // its own 60%
		"b": {256000, 256000, 209920}, // 95% capped to the usable 82%
		"c": {200000, 200000, 150000}, // out of range → shared 75%, default window
		"d": {200000, 200000, 150000},
	}
	for _, m := range catalog.Models {
		if got := [3]int{m.Window, m.Max, m.Compact}; got != want[m.Slug] {
			t.Errorf("%s: window/max/compact = %v, want %v", m.Slug, got, want[m.Slug])
		}
	}
}

// Reading the catalog back: the shared compact percent is the most common
// one (per-model overrides don't leak into it), rounded so an odd window
// doesn't read back one point low.
func TestReadCodexConfig_RestoresSharedCompact(t *testing.T) {
	read := func(prefs *CodexPrefs, windows map[string]int) string {
		t.Helper()
		t.Setenv("HOME", t.TempDir())
		if _, err := ApplyCodexConfigWithContextWindows("http://h/tingly/codex", []string{"first", "b", "c"}, prefs, true, windows, ""); err != nil {
			t.Fatal(err)
		}
		got, _, _, err := ReadCodexConfig()
		if err != nil {
			t.Fatal(err)
		}
		return got.AutoCompactPercent
	}
	odd := map[string]int{"first": 131072, "b": 131072, "c": 262143}
	if got := read(&CodexPrefs{AutoCompactPercent: "70", ModelAutoCompactPercent: map[string]int{"first": 55}}, odd); got != "70" {
		t.Errorf("shared compact = %q, want 70", got)
	}
	if got := read(DefaultCodexPrefs(), odd); got != "" {
		t.Errorf("default compact = %q, want empty", got)
	}
}
