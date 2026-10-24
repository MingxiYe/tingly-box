package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	tomlpkg "github.com/pelletier/go-toml/v2"
	"github.com/tingly-dev/tingly-box/ai"
	"github.com/tingly-dev/tingly-box/internal/catalog"
	"github.com/tingly-dev/tingly-box/internal/typ"
)

// Codex config/auth application: render and merge the tingly-managed
// sections of Codex's config.toml, model catalog, and auth.json.

// codexGatewayProviderName is the tingly-box provider key written into
// config.toml's [model_providers] table by mergeCodexConfig and removed by
// ClearCodexGatewayConfig.
const codexGatewayProviderName = "tingly-box"

// codexGatewayTopLevelKeys are the top-level config.toml keys owned by
// tingly-box. Both mergeCodexConfig (writer) and ClearCodexGatewayConfig
// (eraser) reference this list so the two functions stay in sync.
var codexGatewayTopLevelKeys = []string{"model", "model_provider", "model_catalog_json"}

// codexModelCatalogFile is the basename of the tingly-managed Codex model
// catalog file written next to config.toml. config.toml's `model_catalog_json`
// is pointed at the absolute path of this file so `/model` can enumerate
// tingly-served models.
const codexModelCatalogFile = "tingly-model-catalog.json"

const codexModelCatalogSchema = "https://raw.githubusercontent.com/tingly-dev/tingly-box/main/internal/config/codex-model-catalog.schema.json"

// CodexPrefs is the typed, user-tunable surface of Codex's config.toml.
// JSON tags map 1:1 to the config.toml keys, so the frontend round-trips the
// same field names. Values are kept as strings so empty = omit (let Codex use
// its own default), avoiding the "0/false means unset" ambiguity.
//
// The struct itself is the whitelist: only these keys can ever be set from a
// request, so prefs can never clobber tingly-managed fields (model,
// model_provider, model_catalog_json, model_providers.*) or inject arbitrary
// TOML. Scope is deliberately limited to model/reasoning knobs (not
// approval_policy / sandbox_mode safety toggles).
type CodexPrefs struct {
	ModelReasoningEffort  string `json:"model_reasoning_effort,omitempty"`
	ModelReasoningSummary string `json:"model_reasoning_summary,omitempty"`
	ModelVerbosity        string `json:"model_verbosity,omitempty"`

	// Catalog-only tunables: they are not config.toml keys (toConfig skips
	// them) but shape the generated tingly-model-catalog.json. The percent
	// fields are decimal strings ("" or out of range = built-in default);
	// SupportsReasoningSummaries is "true" or "" and sets each catalog entry's
	// supports_reasoning_summaries (Codex's config.toml no longer has a
	// model_supports_reasoning_summaries key).
	SupportsReasoningSummaries    string `json:"supports_reasoning_summaries,omitempty"`
	EffectiveContextWindowPercent string `json:"effective_context_window_percent,omitempty"`
	AutoCompactPercent            string `json:"auto_compact_percent,omitempty"`

	// ModelAutoCompactPercent carries per-model overrides of AutoCompactPercent
	// (catalog slug -> percent), filled by the server from the rules'
	// codex_compact_percent flag. Never read from a request.
	ModelAutoCompactPercent map[string]int `json:"-"`

	// ModelMaxContextWindow carries per-model ceilings (catalog slug ->
	// max_context_window) above the model's window, filled by the server from
	// the rules (BuildMaxContextWindowsFromRules). A model without one gets a
	// ceiling equal to its window. Never read from a request.
	ModelMaxContextWindow map[string]int `json:"-"`
}

// codexLegacySupportsSummariesKey is the config.toml key older versions wrote;
// removed from Codex's config schema, now expressed per catalog entry.
const codexLegacySupportsSummariesKey = "model_supports_reasoning_summaries"

// Bounds for the catalog headroom percentages. Below the floor a session would
// compact almost immediately; above 100 is meaningless.
const (
	codexMinContextPercent = 50
	codexMaxContextPercent = 100
)

// contextHeadroom resolves the effective-window and auto-compact percentages,
// falling back to the defaults for empty or out-of-range input. Compaction is
// clamped to the effective window so it always fires before the usable window
// is exhausted.
func (p *CodexPrefs) contextHeadroom() (effective, compact int) {
	effective, compact = codexEffectiveContextWindowPercent, codexDefaultAutoCompactTokenLimitPct
	if p != nil {
		effective = codexParsePercent(p.EffectiveContextWindowPercent, effective)
		compact = codexParsePercent(p.AutoCompactPercent, compact)
	}
	return effective, min(compact, effective)
}

// modelCompactPercent resolves one model's auto-compact percentage: the
// rule-level override when it is in range, else the shared default. The result
// never exceeds the usable window (effective).
func (p *CodexPrefs) modelCompactPercent(model string, effective, fallback int) int {
	pct := fallback
	if p != nil {
		if v, ok := p.ModelAutoCompactPercent[model]; ok && v >= codexMinContextPercent && v <= codexMaxContextPercent {
			pct = v
		}
	}
	return min(pct, effective)
}

// modelMaxContextWindow is one model's max_context_window: its ceiling from
// ModelMaxContextWindow when that is above the window, else the window.
func (p *CodexPrefs) modelMaxContextWindow(model string, window int) int {
	if p != nil {
		if v, ok := p.ModelMaxContextWindow[model]; ok && v > window {
			return v
		}
	}
	return window
}

func codexParsePercent(raw string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < codexMinContextPercent || n > codexMaxContextPercent {
		return fallback
	}
	return n
}

// codexEnumValues lists the valid values for each enum-typed CodexPrefs field.
// Values outside the set are dropped during conversion (forward-compatible,
// injection-safe).
var codexEnumValues = map[string][]string{
	"model_reasoning_effort":  {"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"},
	"model_reasoning_summary": {"auto", "concise", "detailed", "none"},
	"model_verbosity":         {"low", "medium", "high"},
}

// DefaultCodexPrefs returns the defaults for the CLI path and no-prefs fallback.
// All fields are empty so tingly-box stays out of the way for third-party
// providers that may not support OpenAI reasoning-summary extensions.
// Users who need reasoning summaries can enable them via the Quick Config form.
func DefaultCodexPrefs() *CodexPrefs {
	// Default reasoning effort to "medium" rather than leaving it unset — a
	// concrete, sensible default beats deferring to Codex's built-in default.
	return &CodexPrefs{ModelReasoningEffort: "medium"}
}

// toConfig converts prefs into a map of native TOML values ready to merge into
// config.toml. Empty values and invalid enum members are dropped; the bool
// field maps "true" -> true (anything else omitted).
func (p *CodexPrefs) toConfig() map[string]interface{} {
	out := map[string]interface{}{}
	if p == nil {
		return out
	}
	setEnum := func(key, val string) {
		if v, ok := codexEnumValue(key, val); ok {
			out[key] = v
		}
	}
	setEnum("model_reasoning_effort", p.ModelReasoningEffort)
	setEnum("model_reasoning_summary", p.ModelReasoningSummary)
	setEnum("model_verbosity", p.ModelVerbosity)
	return out
}

// codexEnumValue validates a value against the allowed set for an enum-typed
// CodexPrefs key (see codexEnumValues). It returns the trimmed value and true
// when it is a member, or ""/false otherwise (empty input also yields false).
// Shared by toConfig (write) and CodexPrefsFromConfig (read) so the two stay
// in lockstep — there is one definition of "what is a valid enum value".
func codexEnumValue(key, val string) (string, bool) {
	val = strings.TrimSpace(val)
	if val == "" {
		return "", false
	}
	if slices.Contains(codexEnumValues[key], val) {
		return val, true
	}
	return "", false
}

// CodexPrefsFromConfig is the inverse of (*CodexPrefs).toConfig: it extracts
// the typed, whitelisted CodexPrefs keys from a parsed config.toml top-level
// map. Only the four managed keys are read; enum values are validated (invalid
// values dropped) and the bool field is normalized back to "true"/"" so it
// round-trips through the same JSON shape the frontend edits. Keys outside the
// whitelist are ignored — a hand-edited config.toml can never smuggle extra
// fields into the prefs surface.
func CodexPrefsFromConfig(cfg map[string]interface{}) *CodexPrefs {
	prefs := &CodexPrefs{}
	// Enum-typed keys: validate against codexEnumValues (shared with toConfig)
	// so an out-of-set value is dropped rather than surfaced in the form.
	if v, ok := cfg["model_reasoning_effort"].(string); ok {
		if val, ok := codexEnumValue("model_reasoning_effort", v); ok {
			prefs.ModelReasoningEffort = val
		}
	}
	if v, ok := cfg["model_reasoning_summary"].(string); ok {
		if val, ok := codexEnumValue("model_reasoning_summary", v); ok {
			prefs.ModelReasoningSummary = val
		}
	}
	if v, ok := cfg["model_verbosity"].(string); ok {
		if val, ok := codexEnumValue("model_verbosity", v); ok {
			prefs.ModelVerbosity = val
		}
	}
	// Legacy: older tingly-box versions wrote model_supports_reasoning_summaries
	// to config.toml (the key is no longer in Codex's schema). Read it so an
	// existing opt-in survives the move to the catalog; the next apply drops it.
	// true -> "true"; anything else leaves it unset. Accept both a native TOML
	// bool and the string form (older files / hand-edits).
	if v, ok := cfg[codexLegacySupportsSummariesKey]; ok {
		if b, ok := v.(bool); ok && b {
			prefs.SupportsReasoningSummaries = "true"
		} else if s, ok := v.(string); ok && strings.TrimSpace(s) == "true" {
			prefs.SupportsReasoningSummaries = "true"
		}
	}
	return prefs
}

// isTinglyManagedCodexConfig reports whether a parsed config.toml was written
// by tingly-box. The reliable signals are an explicit
// `model_provider = "tingly-box"` or a `[model_providers.tingly-box]` stanza.
// The generic `model`/`model_catalog_json` keys are deliberately NOT signals —
// a stock codex install always has `model`, so flagging on it would mark every
// codex config as tingly-owned. Both ReadCodexConfig (read) and
// ClearCodexGatewayConfig (mutate) route through this so the read/clear pair
// cannot drift on what "tingly owns" means.
func isTinglyManagedCodexConfig(cfg map[string]interface{}) bool {
	if provider, ok := cfg["model_provider"].(string); ok && provider == codexGatewayProviderName {
		return true
	}
	if providers, ok := cfg["model_providers"].(map[string]interface{}); ok {
		if _, ok := providers[codexGatewayProviderName]; ok {
			return true
		}
	}
	return false
}

// ReadCodexConfig reads ~/.codex/config.toml and returns the typed prefs, the
// inferred writeCatalog state (true when model_catalog_json is set), and
// whether a tingly-managed config exists. A missing or unparseable file yields
// empty prefs, writeCatalog=false, exists=false. exists is true only when the
// file is tingly-managed (see isTinglyManagedCodexConfig) so a
// never-configured machine reads as "not applied" and the form falls back to
// defaults.
func ReadCodexConfig() (prefs *CodexPrefs, writeCatalog bool, exists bool, err error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, false, false, fmt.Errorf("failed to get home directory: %w", err)
	}
	targetPath := filepath.Join(homeDir, ".codex", "config.toml")

	data, readErr := os.ReadFile(targetPath)
	if readErr != nil {
		// Missing file is not an error — first-time setup, no applied state.
		return DefaultCodexPrefs(), false, false, nil
	}

	cfg := map[string]interface{}{}
	if err := tomlpkg.Unmarshal(data, &cfg); err != nil {
		// Unparseable file: surface the error but still report non-existence so
		// the form falls back to defaults rather than showing a blank state.
		return DefaultCodexPrefs(), false, false, nil
	}

	_, hasCatalog := cfg["model_catalog_json"]
	prefs = CodexPrefsFromConfig(cfg)
	restoreCodexCatalogHeadroom(prefs, cfg)
	return prefs, hasCatalog, isTinglyManagedCodexConfig(cfg), nil
}

// ApplyCodexConfig merges tingly-box Codex settings into ~/.codex/config.toml
// and writes ~/.codex/tingly-model-catalog.json with one entry per supplied
// model so Codex's `/model` picker can see them.
//
// This is the backward-compatible version that uses default context windows.
// For context window support, use ApplyCodexConfigWithContextWindows.
func ApplyCodexConfig(baseURL string, models []string, prefs *CodexPrefs, writeCatalog bool) (*ApplyResult, error) {
	return ApplyCodexConfigWithContextWindows(baseURL, models, prefs, writeCatalog, nil, "")
}

// ApplyCodexConfigWithContextWindows merges tingly-box Codex settings into ~/.codex/config.toml
// and writes ~/.codex/tingly-model-catalog.json with one entry per supplied
// model so Codex's `/model` picker can see them.
//
// The contextWindows parameter overrides the catalog's default context window
// for specific models (e.g., 1M for models with the context_1m flag); nil uses
// defaults.
//
// MERGE semantics: only fields tingly-box manages are overwritten. Everything
// else the user put in config.toml — other top-level keys, other entries under
// `[model_providers.*]`, and unrelated `[profiles.*]` blocks — is left alone.
//
// Managed fields:
//   - top-level `model` (set to models[0] when models is non-empty)
//   - top-level `model_provider = "tingly-box"`
//   - top-level `model_catalog_json` (set to the absolute path of the
//     catalog file when models is non-empty; cleared otherwise so we don't
//     point at a missing file)
//   - `[model_providers.tingly-box]` (always re-pinned to the supplied base URL)
//   - `[profiles.<sanitized(model)>]` for each model — overwritten unconditionally
//     under that key; `agent restore codex` recovers the previous file if needed
//   - the whitelisted user prefs (see codexPrefSpec, e.g.
//     `model_reasoning_effort`, `model_reasoning_summary`, `model_verbosity`) at the top level
//     and inside each managed profile
//
// Note: Codex's `model_catalog_json` REPLACES the bundled catalog (it does not
// merge), and is read on startup only — switching via `/model` doesn't reload
// it. Users wanting native OpenAI entries in `/model` should keep the bundled
// catalog (i.e. not run apply) or merge by hand.
//
// Orphan tingly profiles from earlier applies are NOT garbage-collected; if
// the user has trimmed their rules they can remove stale profiles by hand.
//
// The previous config.toml and catalog (if any) are backed up before being
// rewritten.
//
// bearerToken (hybrid mode) is embedded into the tingly-box provider stanza as
// experimental_bearer_token; pass "" for the classic gateway path where the key
// is written to auth.json instead.
func ApplyCodexConfigWithContextWindows(baseURL string, models []string, prefs *CodexPrefs, writeCatalog bool, contextWindows map[string]int, bearerToken string) (*ApplyResult, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}
	if homeDir == "" {
		// os.UserHomeDir can succeed and return "" in odd container setups
		// where neither $HOME nor /etc/passwd resolves the current user.
		// We refuse to proceed because filepath.Join would emit "/.codex/..."
		// which Codex rejects as a non-absolute catalog path.
		return nil, fmt.Errorf("home directory resolved to empty path")
	}

	configDir := filepath.Join(homeDir, ".codex")
	targetPath := filepath.Join(configDir, "config.toml")
	catalogPath := filepath.Join(configDir, codexModelCatalogFile)
	result := &ApplyResult{}

	if err := os.MkdirAll(configDir, 0755); err != nil {
		result.Message = fmt.Sprintf("Failed to create directory: %v", err)
		return result, nil
	}

	existing := map[string]interface{}{}
	if data, err := os.ReadFile(targetPath); err == nil {
		if err := tomlpkg.Unmarshal(data, &existing); err != nil {
			result.Message = fmt.Sprintf("Failed to parse existing TOML: %v", err)
			return result, nil
		}
		backupPath, err := backupFile(targetPath)
		if err != nil {
			result.Message = fmt.Sprintf("Failed to create backup: %v", err)
			return result, nil
		}
		result.BackupPath = backupPath
		result.Updated = true
	} else {
		result.Created = true
	}

	catalogPathForConfig := ""
	if len(models) > 0 && writeCatalog {
		catalogPathForConfig = catalogPath
	}
	mergeCodexConfig(existing, baseURL, models, catalogPathForConfig, prefs, bearerToken)

	out, err := tomlpkg.Marshal(existing)
	if err != nil {
		result.Message = fmt.Sprintf("Failed to marshal TOML: %v", err)
		return result, nil
	}
	if err := os.WriteFile(targetPath, out, 0644); err != nil {
		result.Message = fmt.Sprintf("Failed to write file: %v", err)
		return result, nil
	}

	if len(models) > 0 && writeCatalog {
		if _, err := os.Stat(catalogPath); err == nil {
			if _, err := backupFile(catalogPath); err != nil {
				result.Message = fmt.Sprintf("Failed to back up catalog: %v", err)
				return result, nil
			}
		}
		catalogBytes, err := RenderCodexModelCatalogWithPrefs(models, contextWindows, prefs)
		if err != nil {
			result.Message = fmt.Sprintf("Failed to render model catalog: %v", err)
			return result, nil
		}
		if err := os.WriteFile(catalogPath, catalogBytes, 0644); err != nil {
			result.Message = fmt.Sprintf("Failed to write catalog: %v", err)
			return result, nil
		}
	}

	result.Success = true
	if result.Created {
		result.Message = fmt.Sprintf("Created %s", targetPath)
	} else if result.BackupPath != "" {
		result.Message = fmt.Sprintf("Updated %s (backup: %s)", targetPath, result.BackupPath)
	} else {
		result.Message = fmt.Sprintf("Updated %s", targetPath)
	}
	return result, nil
}

// RenderCodexConfigTOML returns the TOML that would be written to a fresh
// ~/.codex/config.toml — i.e. the merge applied to an empty starting point.
// Used by the preview endpoint so the UI can show exactly what's pending.
func RenderCodexConfigTOML(baseURL string, models []string, prefs *CodexPrefs, writeCatalog bool, bearerToken string) ([]byte, error) {
	catalogPathForConfig := ""
	if len(models) > 0 && writeCatalog {
		// Guard against environments where UserHomeDir returns "" with no
		// error (rare, but it makes filepath.Join emit "/.codex/..." which
		// Codex then fails to parse as AbsolutePathBuf). Better to omit the
		// field entirely than to write a broken path.
		if homeDir, err := os.UserHomeDir(); err == nil && homeDir != "" {
			catalogPathForConfig = filepath.Join(homeDir, ".codex", codexModelCatalogFile)
		}
	}
	cfg := map[string]interface{}{}
	mergeCodexConfig(cfg, baseURL, models, catalogPathForConfig, prefs, bearerToken)
	return tomlpkg.Marshal(cfg)
}

// mergeCodexConfig mutates cfg in place, applying tingly-managed fields while
// preserving everything else. See ApplyCodexConfig for the contract.
//
// catalogPath is the absolute path to write into `model_catalog_json`. Pass
// "" to leave that key untouched (e.g. when no models are configured — we
// don't want to point Codex at a file we never wrote).
//
// bearerToken, when non-empty, is written into the tingly-box provider stanza
// as `experimental_bearer_token` (with `requires_openai_auth = true`). This is
// the hybrid-mode path: it keeps the gateway credential provider-scoped inside
// config.toml so ~/.codex/auth.json can retain a native ChatGPT login instead.
// Pass "" for the classic gateway path where the key lives in auth.json's
// OPENAI_API_KEY.
func mergeCodexConfig(cfg map[string]interface{}, baseURL string, models []string, catalogPath string, prefs *CodexPrefs, bearerToken string) {
	// User-tunable, whitelist-validated keys. Applied at the top level (global
	// default) and stamped into each generated profile so profiles are
	// self-contained. Converted first so it can never carry a managed key.
	coerced := prefs.toConfig()
	maps.Copy(cfg, coerced)
	delete(cfg, codexLegacySupportsSummariesKey)

	// Managed fields — written after prefs so they always win, guaranteeing
	// prefs cannot clobber them (defense in depth on top of the whitelist).
	if len(models) > 0 {
		cfg["model"] = models[0]
	}
	cfg["model_provider"] = codexGatewayProviderName
	if catalogPath != "" {
		cfg["model_catalog_json"] = catalogPath
	}

	providers, _ := cfg["model_providers"].(map[string]interface{})
	if providers == nil {
		providers = map[string]interface{}{}
	}
	providerStanza := map[string]interface{}{
		"name":     "OpenAI using Tingly Box",
		"base_url": baseURL,
		"wire_api": "responses",
	}
	if bearerToken != "" {
		// Hybrid: provider-scoped credential keeps the gateway token out of
		// auth.json so a native ChatGPT login can coexist there.
		// requires_openai_auth=true tells Codex this provider still requires the
		// OpenAI auth path (the credential arrives via the bearer token above).
		providerStanza["experimental_bearer_token"] = bearerToken
		providerStanza["requires_openai_auth"] = true
	} else {
		// Gateway (apikey): the token lives in ~/.codex/auth.json's
		// OPENAI_API_KEY. requires_openai_auth=true is the schema-documented way
		// to tell Codex to source this provider's credential from auth.json.
		// (Codex's `preferred_auth_method` field was removed from the config
		// schema, which is additionalProperties:false — writing it is rejected.)
		providerStanza["requires_openai_auth"] = true
	}
	providers[codexGatewayProviderName] = providerStanza
	cfg["model_providers"] = providers

	profiles, _ := cfg["profiles"].(map[string]interface{})
	if profiles == nil {
		profiles = map[string]interface{}{}
	}
	for _, model := range models {
		profile := map[string]interface{}{
			"model":          model,
			"model_provider": codexGatewayProviderName,
		}
		maps.Copy(profile, coerced)
		profiles[sanitizeCodexProfileKey(model)] = profile
	}
	if len(profiles) > 0 {
		cfg["profiles"] = profiles
	}
}

const (
	// Window (and ceiling) of a catalog model nothing better is known for; see
	// CodexAutoContextWindow for how routed models get their own.
	codexDefaultContextWindow            = 200000
	codexDefaultMaxContextWindow         = 200000
	codexEffectiveContextWindowPercent   = 82
	codexDefaultAutoCompactTokenLimitPct = 75

	// 1M context window for models that support it (Sonnet 4.6+, Opus 4.6+)
	codex1MContextWindow = 1000000

	// Bounds for a rule's own codex_context_window; values outside are ignored.
	codexMinContextWindow = 8_000
	codexMaxContextWindow = 10_000_000
)

// renderCodexModelCatalog produces the JSON payload for
// ~/.codex/tingly-model-catalog.json. Each model becomes one ModelInfo entry
// with the required fields populated using conservative defaults that match
// the OpenAI Responses API surface (text-in/text-out, reasoning summaries on,
// no verbosity knob). Codex 0.124+ deserializes this into
// `protocol::openai_models::ModelsResponse`; field names and value types must
// stay in sync with that struct.
//
// The contextWindows parameter allows overriding the default context window
// for specific models (e.g., 1M context window models). If nil, uses default.
func RenderCodexModelCatalog(models []string, contextWindows map[string]int) ([]byte, error) {
	return RenderCodexModelCatalogWithPrefs(models, contextWindows, nil)
}

// RenderCodexModelCatalogWithPrefs is RenderCodexModelCatalog with the
// effective-window and auto-compact percentages taken from prefs (nil = defaults).
func RenderCodexModelCatalogWithPrefs(models []string, contextWindows map[string]int, prefs *CodexPrefs) ([]byte, error) {
	effectivePct, compactPct := prefs.contextHeadroom()
	supportsSummaries := prefs != nil && strings.TrimSpace(prefs.SupportsReasoningSummaries) == "true"
	// supported_reasoning_levels is Vec<ReasoningEffortPreset>, not a bare
	// string list — each element is an {effort, description} object. Values
	// mirror Codex's bundled catalog for GPT-5 so /model shows the familiar
	// presets.
	reasoningPresets := []map[string]interface{}{
		{"effort": "minimal", "description": "Minimal reasoning for the fastest responses"},
		{"effort": "low", "description": "Fast responses with lighter reasoning"},
		{"effort": "medium", "description": "Balances speed and reasoning depth for everyday tasks"},
		{"effort": "high", "description": "Greater reasoning depth for complex problems"},
	}
	entries := make([]map[string]interface{}, 0, len(models))
	for _, model := range models {
		// Per-model window (see BuildContextWindowsFromRules); indexing a nil
		// map is safe. The ceiling is the window unless prefs carry a higher one.
		contextWindow := codexDefaultContextWindow
		if cw, ok := contextWindows[model]; ok {
			contextWindow = cw
		}
		maxContextWindow := prefs.modelMaxContextWindow(model, contextWindow)

		entries = append(entries, map[string]interface{}{
			"slug":                             model,
			"display_name":                     model,
			"description":                      "Tingly Box managed model",
			"supported_reasoning_levels":       reasoningPresets,
			"default_reasoning_level":          "medium",
			"shell_type":                       "shell_command",
			"visibility":                       "list",
			"supported_in_api":                 true,
			"priority":                         0,
			"base_instructions":                "",
			"supports_reasoning_summaries":     supportsSummaries,
			"default_reasoning_summary":        "none",
			"support_verbosity":                false,
			"truncation_policy":                map[string]interface{}{"mode": "tokens", "limit": 10000},
			"supports_parallel_tool_calls":     true,
			"context_window":                   contextWindow,
			"max_context_window":               maxContextWindow,
			"auto_compact_token_limit":         contextWindow * prefs.modelCompactPercent(model, effectivePct, compactPct) / 100,
			"effective_context_window_percent": effectivePct,
			"experimental_supported_tools":     []string{},
			"input_modalities":                 []string{"text", "image"},
			"apply_patch_tool_type":            "freeform",
		})
	}
	payload := map[string]interface{}{
		"$schema": codexModelCatalogSchema,
		"models":  entries,
	}
	return json.MarshalIndent(payload, "", "  ")
}

// restoreCodexCatalogHeadroom reads the headroom percentages back from the
// applied catalog so the form shows what was written. Values equal to the
// defaults stay empty (= follow the default).
func restoreCodexCatalogHeadroom(prefs *CodexPrefs, cfg map[string]interface{}) {
	path, _ := cfg["model_catalog_json"].(string)
	if path == "" {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var catalog struct {
		Models []struct {
			ContextWindow     int  `json:"context_window"`
			AutoCompactLimit  int  `json:"auto_compact_token_limit"`
			EffectivePercent  int  `json:"effective_context_window_percent"`
			SupportsSummaries bool `json:"supports_reasoning_summaries"`
		} `json:"models"`
	}
	if json.Unmarshal(raw, &catalog) != nil || len(catalog.Models) == 0 {
		return
	}
	m := catalog.Models[0]
	if m.SupportsSummaries {
		prefs.SupportsReasoningSummaries = "true"
	}
	if m.EffectivePercent != codexEffectiveContextWindowPercent && m.EffectivePercent >= codexMinContextPercent && m.EffectivePercent <= codexMaxContextPercent {
		prefs.EffectiveContextWindowPercent = strconv.Itoa(m.EffectivePercent)
	}
	// Individual models can carry their own compact percent (rule override), so
	// the shared default is the most common value, first entry winning ties.
	counts := map[int]int{}
	compact, best := 0, 0
	for _, e := range catalog.Models {
		if e.ContextWindow <= 0 {
			continue
		}
		pct := e.AutoCompactLimit * 100 / e.ContextWindow
		counts[pct]++
		if counts[pct] > best {
			compact, best = pct, counts[pct]
		}
	}
	if compact != codexDefaultAutoCompactTokenLimitPct && compact >= codexMinContextPercent && compact <= codexMaxContextPercent {
		prefs.AutoCompactPercent = strconv.Itoa(compact)
	}
}

func codexAutoCompactTokenLimit(contextWindow int) int {
	return contextWindow * codexDefaultAutoCompactTokenLimitPct / 100
}

// Where a Codex catalog model's window comes from (CodexContextWindow.Source).
const (
	// CodexWindowSourceRule is the rule's own codex_context_window.
	CodexWindowSourceRule = "rule"
	// CodexWindowSourceCatalog is the routed model's input limit in the
	// provider catalog (max_input_tokens), with its larger opt-in window
	// (max_context) as the ceiling when the catalog has one.
	CodexWindowSourceCatalog = "catalog"
	// CodexWindowSourceExtended is that larger opt-in window, which the
	// rule's 1M flag asks for: Codex's own switch raises ChatGPT-backed models
	// from 272K to 872K, not to 1M.
	CodexWindowSourceExtended = "extended"
	// CodexWindowSourceAnthropic is a Claude model on a provider with an
	// Anthropic-style endpoint, sent without the context-1m header (the rule's
	// 1M flag is off, or the request goes to the provider's OpenAI URL, which
	// never carries it): it answers with 200K, whatever larger window the
	// catalog lists.
	CodexWindowSourceAnthropic = "anthropic"
	// CodexWindowSource1M is a Claude model on an Anthropic-style endpoint
	// with the rule's 1M flag: the header it adds opens 1M.
	CodexWindowSource1M = "1m"
	// CodexWindowSourceDefault is a model the catalog doesn't know: 200K, or
	// 1M with the rule's 1M flag (its old meaning, kept where nothing better
	// is known). Both are guesses.
	CodexWindowSourceDefault = "default"
)

// CodexContextWindow is what one Codex catalog model is told about its
// context, and why. Window is written as context_window (what Codex plans
// around: its context meter and when it compacts); Max as max_context_window
// (how far Codex's own model_context_window setting may raise it). Both count
// input only, like max_input_tokens.
type CodexContextWindow struct {
	Window int
	Max    int
	Source string
}

// Known reports whether the window comes from what Tingly Box knows about the
// rule or its upstream, rather than a guess for an unknown model.
func (w CodexContextWindow) Known() bool {
	return w.Source != CodexWindowSourceDefault
}

// codexAnthropicStandardWindow is what a Claude model on an Anthropic-style
// endpoint answers with when the context-1m beta header is not sent.
const codexAnthropicStandardWindow = 200000

// CodexAutoContextWindow is the window a Codex rule gets from its routed
// models alone, ignoring its own codex_context_window: what the rule's "Auto"
// resolves to.
//
// Every upstream the rule can reach counts (ruleUpstreams, the same ones
// RuleModelInfo reads). Each contributes:
//
//   - a Claude model on a provider with an Anthropic-style endpoint: 1M when
//     the request goes there with the rule's 1M flag (the header that flag
//     adds is what opens it), else 200K, or less when the catalog says so;
//   - a model the provider catalog knows: its input limit, with its larger
//     opt-in window as the ceiling. The 1M flag asks for that larger window
//     and changes nothing for a model without one;
//   - anything else: 200K, or 1M with the 1M flag (its old meaning, kept where
//     nothing better is known).
//
// The rule gets the smallest window and the smallest ceiling: Codex can't know
// which upstream will answer, and only the smallest is safe for all. A rule
// with no reachable upstream is judged like an unknown model.
func (c *Config) CodexAutoContextWindow(rule typ.Rule) CodexContextWindow {
	unknown := CodexContextWindow{Window: codexDefaultContextWindow, Max: codexDefaultMaxContextWindow, Source: CodexWindowSourceDefault}
	if rule.Flags.Context1M {
		unknown.Window, unknown.Max = codex1MContextWindow, codex1MContextWindow
	}
	upstreams := c.ruleUpstreams(rule)
	if len(upstreams) == 0 {
		return unknown
	}
	tm := c.modelCatalog()
	var best *CodexContextWindow
	for _, up := range upstreams {
		w := codexUpstreamWindow(tm, up, rule, unknown)
		if best == nil {
			best = &w
			continue
		}
		// On a tie, what is known beats a guess, whatever the service order.
		if w.Window < best.Window || (w.Window == best.Window && w.Known() && !best.Known()) {
			w.Max = min(w.Max, best.Max)
			best = &w
		} else {
			best.Max = min(best.Max, w.Max)
		}
	}
	return *best
}

// codexUpstreamWindow is one routed upstream's contribution to a Codex rule's
// window (see CodexAutoContextWindow).
func codexUpstreamWindow(tm *catalog.ProviderCatalogManager, up ruleUpstream, rule typ.Rule, unknown CodexContextWindow) CodexContextWindow {
	model, info, known := upstreamModelInfo(tm, up, rule.RequestModel)
	input := info.InputLimit()
	known = known && input > 0

	if claude, header := codexClaudeEndpoint(up.provider, rule, model); claude {
		if header && rule.Flags.Context1M {
			return CodexContextWindow{Window: codex1MContextWindow, Max: codex1MContextWindow, Source: CodexWindowSource1M}
		}
		if known && input <= codexAnthropicStandardWindow {
			return CodexContextWindow{Window: input, Max: input, Source: CodexWindowSourceCatalog}
		}
		return CodexContextWindow{Window: codexAnthropicStandardWindow, Max: codexAnthropicStandardWindow, Source: CodexWindowSourceAnthropic}
	}
	if !known {
		return unknown
	}
	ceiling := max(input, info.InputCeiling())
	if rule.Flags.Context1M && ceiling > input {
		return CodexContextWindow{Window: ceiling, Max: ceiling, Source: CodexWindowSourceExtended}
	}
	return CodexContextWindow{Window: input, Max: ceiling, Source: CodexWindowSourceCatalog}
}

// codexClaudeEndpoint reports whether a Codex request for model reaches a
// Claude model on a provider with an Anthropic-style endpoint (claude), where
// the context-1m beta header decides the window, and whether the request is
// sent to that endpoint (header), the only one the rule's 1M flag can add the
// header on. Codex speaks OpenAI, so a provider with a dual OpenAI URL serves
// it there unless the rule forces the Anthropic endpoint. Other models behind
// an Anthropic-style endpoint (DeepSeek's) keep their own window.
func codexClaudeEndpoint(provider *typ.Provider, rule typ.Rule, model string) (claude, header bool) {
	if !strings.Contains(strings.ToLower(model), "claude") {
		return false, false
	}
	if _, s := provider.ResolveEndpoint(ai.APIStyleAnthropic); s != ai.APIStyleAnthropic {
		return false, false
	}
	_, style := provider.ResolveEndpoint(ai.APIStyleOpenAI)
	return true, style == ai.APIStyleAnthropic || rule.Flags.AnthropicEndpointOverride == "anthropic"
}

// CodexContextWindowFor is the window a Codex rule's catalog entry gets: its
// own codex_context_window when in range, else CodexAutoContextWindow. An own
// window is also its ceiling: it is set for models whose real window Tingly
// Box doesn't know, where a derived ceiling would only be a guess.
func (c *Config) CodexContextWindowFor(rule typ.Rule) CodexContextWindow {
	if w := rule.Flags.CodexContextWindow; w >= codexMinContextWindow && w <= codexMaxContextWindow {
		return CodexContextWindow{Window: w, Max: w, Source: CodexWindowSourceRule}
	}
	return c.CodexAutoContextWindow(rule)
}

// ResolveCodexContextWindows returns the window of every model the Codex
// catalog lists: active Codex rules, keyed by request model verbatim, like
// collectCodexRuleModels. Two rules with the same request model share one
// catalog entry, so the smaller window wins.
func ResolveCodexContextWindows(cfg *Config) map[string]CodexContextWindow {
	out := make(map[string]CodexContextWindow)
	if cfg == nil {
		return out
	}
	for _, rule := range cfg.GetRequestConfigs() {
		if rule.GetScenario() != typ.ScenarioCodex || !rule.Active {
			continue
		}
		model := strings.TrimSpace(rule.RequestModel)
		if model == "" {
			continue
		}
		w := cfg.CodexContextWindowFor(rule)
		if prev, ok := out[model]; ok {
			// One entry for both: the smaller window and the smaller ceiling,
			// whatever the rule order.
			if prev.Window <= w.Window {
				prev, w = w, prev
			}
			w.Max = max(w.Window, min(w.Max, prev.Max))
		}
		out[model] = w
	}
	return out
}

// BuildContextWindowsFromRules maps each Codex catalog model to the window
// (context_window) ResolveCodexContextWindows gives it: the rule's own
// codex_context_window, else what its routed models accept, else 1M for the
// context_1m flag, else the 200K default. Models at the default are absent:
// the catalog writes the default for them anyway. Keys are the rules' request
// models verbatim — exactly the names collectCodexRuleModels feeds into the
// catalog — so the window always lands on its catalog entry.
func BuildContextWindowsFromRules(cfg *Config) map[string]int {
	windows := make(map[string]int)
	for model, w := range ResolveCodexContextWindows(cfg) {
		if w.Window != codexDefaultContextWindow {
			windows[model] = w.Window
		}
	}
	return windows
}

// BuildMaxContextWindowsFromRules maps each Codex catalog model whose ceiling
// (max_context_window) is above its window to that ceiling, keyed like
// BuildContextWindowsFromRules. Absent models get a ceiling equal to their
// window.
func BuildMaxContextWindowsFromRules(cfg *Config) map[string]int {
	ceilings := make(map[string]int)
	for model, w := range ResolveCodexContextWindows(cfg) {
		if w.Max > w.Window {
			ceilings[model] = w.Max
		}
	}
	return ceilings
}

// BuildCompactPercentsFromRules maps each active Codex rule that sets its own
// codex_compact_percent to that value, keyed like BuildContextWindowsFromRules.
// Rules without the flag are absent: they follow the shared default.
func BuildCompactPercentsFromRules(cfg *Config) map[string]int {
	percents := make(map[string]int)
	for _, rule := range cfg.GetRequestConfigs() {
		if rule.GetScenario() != typ.ScenarioCodex || !rule.Active || rule.Flags.CodexCompactPercent == 0 {
			continue
		}
		if model := strings.TrimSpace(rule.RequestModel); model != "" {
			percents[model] = rule.Flags.CodexCompactPercent
		}
	}
	return percents
}

var codexProfileKeyInvalid = regexp.MustCompile(`[^A-Za-z0-9_-]`)

// sanitizeCodexProfileKey keeps alphanumerics, `_`, `-`; turns anything else
// into `-`; trims edge dashes. Empty result falls back to "tingly".
func sanitizeCodexProfileKey(name string) string {
	out := strings.Trim(codexProfileKeyInvalid.ReplaceAllString(name, "-"), "-")
	if out == "" {
		return "tingly"
	}
	return out
}

// CodexAuthMode selects how `~/.codex/auth.json` is populated.
type CodexAuthMode string

const (
	// CodexAuthAPIKey writes only `OPENAI_API_KEY` — used when codex CLI
	// should talk to tingly-box as a gateway.
	CodexAuthAPIKey CodexAuthMode = "apikey"
	// CodexAuthChatGPT exports a native ChatGPT-login auth.json so codex CLI
	// can talk to OpenAI directly using OAuth tokens previously obtained by
	// tingly-box. tingly-box does NOT refresh these tokens afterwards —
	// codex CLI owns their lifecycle from that point on.
	CodexAuthChatGPT CodexAuthMode = "chatgpt"
	// CodexAuthHybrid keeps requests flowing through the tingly-box gateway
	// (the gateway token lives in config.toml's provider stanza as
	// experimental_bearer_token) WHILE preserving a native ChatGPT login in
	// auth.json so Codex App still recognizes the official account (remote
	// control, plugins, account display). When ChatGPT tokens are supplied
	// they are materialized into auth.json; when absent, auth.json is left
	// untouched so an existing `codex login` survives.
	CodexAuthHybrid CodexAuthMode = "hybrid"
)

// ClearCodexGatewayConfig removes tingly-managed top-level keys from
// ~/.codex/config.toml so that when a user switches to native ChatGPT OAuth
// mode the codex CLI falls back to its own defaults rather than trying to
// route requests through the (now-unused) tingly-box gateway.
//
// Only the tingly-managed top-level fields are removed; everything else
// (other provider entries, profiles, user prefs) is left intact. The previous
// config.toml is backed up before modification.
func ClearCodexGatewayConfig() (*ApplyResult, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}
	targetPath := filepath.Join(homeDir, ".codex", "config.toml")
	result := &ApplyResult{}

	data, err := os.ReadFile(targetPath)
	if err != nil {
		// Nothing to clear — treat as success.
		result.Success = true
		result.Message = "no config.toml found, nothing to clear"
		return result, nil
	}

	// Fast path: if the file does not even mention the tingly provider name,
	// skip the unmarshal/marshal round-trip entirely. Re-marshaling user TOML
	// loses comments and reorders keys, so avoiding it in the common no-op case
	// is also a correctness win. isTinglyManagedCodexConfig below is the real
	// authority on whether to act; this is just a cheap bytes-level pre-filter.
	if !bytes.Contains(data, []byte(codexGatewayProviderName)) {
		result.Success = true
		result.Message = "config.toml has no tingly gateway keys, nothing to clear"
		return result, nil
	}

	cfg := map[string]interface{}{}
	if err := tomlpkg.Unmarshal(data, &cfg); err != nil {
		result.Message = fmt.Sprintf("Failed to parse config.toml: %v", err)
		return result, nil
	}

	// Only a tingly-managed config has anything to clear. This shares the exact
	// ownership definition with ReadCodexConfig so the read/clear pair cannot
	// disagree on what "tingly owns".
	if !isTinglyManagedCodexConfig(cfg) {
		result.Success = true
		result.Message = "config.toml has no tingly gateway keys, nothing to clear"
		return result, nil
	}

	changed := false
	for _, k := range codexGatewayTopLevelKeys {
		if _, ok := cfg[k]; ok {
			delete(cfg, k)
			changed = true
		}
	}
	// Also remove the tingly-box provider stanza if present.
	if providers, ok := cfg["model_providers"].(map[string]interface{}); ok {
		if _, ok := providers[codexGatewayProviderName]; ok {
			delete(providers, codexGatewayProviderName)
			if len(providers) == 0 {
				delete(cfg, "model_providers")
			}
			changed = true
		}
	}

	if !changed {
		result.Success = true
		result.Message = "config.toml has no tingly gateway keys, nothing to clear"
		return result, nil
	}

	backupPath, err := backupFile(targetPath)
	if err != nil {
		result.Message = fmt.Sprintf("Failed to create backup: %v", err)
		return result, nil
	}
	result.BackupPath = backupPath

	out, err := tomlpkg.Marshal(cfg)
	if err != nil {
		result.Message = fmt.Sprintf("Failed to marshal TOML: %v", err)
		return result, nil
	}
	if err := os.WriteFile(targetPath, out, 0644); err != nil {
		result.Message = fmt.Sprintf("Failed to write config.toml: %v", err)
		return result, nil
	}

	result.Success = true
	result.Updated = true
	result.Message = fmt.Sprintf("Cleared tingly gateway keys from %s (backup: %s)", targetPath, backupPath)
	return result, nil
}

// CodexChatGPTTokens carries the OAuth credentials needed to materialize a
// native ChatGPT-login `auth.json`.
type CodexChatGPTTokens struct {
	IDToken      string
	AccessToken  string
	RefreshToken string
	AccountID    string
}

// ApplyCodexAuth writes `~/.codex/auth.json`. The previous version (if any) is
// backed up before modification; existing top-level keys outside the managed
// set are preserved.
//
// Mode semantics:
//   - CodexAuthAPIKey: sets `OPENAI_API_KEY` to the supplied key (gateway mode).
//   - CodexAuthChatGPT: writes `tokens` / `last_refresh` / `auth_mode: "chatgpt"`
//     and clears `OPENAI_API_KEY`. Tokens come from the caller; tingly-box does
//     not subsequently refresh them.
//   - CodexAuthHybrid: the gateway credential lives in config.toml (not here),
//     so auth.json only needs to carry the native ChatGPT login. With tokens
//     supplied it behaves like CodexAuthChatGPT; with tokens nil it is a no-op
//     that leaves any existing auth.json (e.g. a prior `codex login`) untouched.
func ApplyCodexAuth(mode CodexAuthMode, apiKey string, tokens *CodexChatGPTTokens) (*ApplyResult, error) {
	// Hybrid with no tokens: preserve whatever login already lives in auth.json.
	if mode == CodexAuthHybrid && tokens == nil {
		return &ApplyResult{Success: true, Message: "Left ~/.codex/auth.json untouched (kept existing ChatGPT login)"}, nil
	}
	// Validate inputs before touching disk so a malformed request can't leave
	// orphaned backups behind.
	payload := map[string]interface{}{}
	switch mode {
	case CodexAuthChatGPT, CodexAuthHybrid:
		if tokens == nil || tokens.AccessToken == "" || tokens.RefreshToken == "" {
			return &ApplyResult{Message: "ChatGPT auth requires access_token and refresh_token"}, nil
		}
		payload["auth_mode"] = "chatgpt"
		tokensMap := map[string]interface{}{
			"access_token":  tokens.AccessToken,
			"refresh_token": tokens.RefreshToken,
		}
		if tokens.IDToken != "" {
			tokensMap["id_token"] = tokens.IDToken
		}
		if tokens.AccountID != "" {
			tokensMap["account_id"] = tokens.AccountID
		}
		payload["tokens"] = tokensMap
		payload["last_refresh"] = time.Now().UTC().Format(time.RFC3339)
	case "", CodexAuthAPIKey:
		payload["OPENAI_API_KEY"] = apiKey
	default:
		return &ApplyResult{Message: fmt.Sprintf("Unknown Codex auth mode: %q", mode)}, nil
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get home directory: %w", err)
	}

	configDir := filepath.Join(homeDir, ".codex")
	targetPath := filepath.Join(configDir, "auth.json")
	result := &ApplyResult{}

	if err := os.MkdirAll(configDir, 0755); err != nil {
		result.Message = fmt.Sprintf("Failed to create directory: %v", err)
		return result, nil
	}

	// Marshal before touching disk so a malformed payload can't leave an
	// orphan backup behind.
	output, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		result.Message = fmt.Sprintf("Failed to marshal JSON: %v", err)
		return result, nil
	}

	// Each mode writes a fresh file — no merging with the previous auth.json.
	// Switching apikey→chatgpt must not leave OPENAI_API_KEY behind, and
	// chatgpt→apikey must not leave the tokens block behind. The backup
	// preserves whatever the user had.
	if _, err := os.Stat(targetPath); err == nil {
		backupPath, err := backupFile(targetPath)
		if err != nil {
			result.Message = fmt.Sprintf("Failed to create backup: %v", err)
			return result, nil
		}
		result.BackupPath = backupPath
		result.Updated = true
	} else {
		result.Created = true
	}

	if err := os.WriteFile(targetPath, output, 0600); err != nil {
		result.Message = fmt.Sprintf("Failed to write file: %v", err)
		return result, nil
	}

	result.Success = true
	if result.Created {
		result.Message = fmt.Sprintf("Created %s", targetPath)
	} else if result.BackupPath != "" {
		result.Message = fmt.Sprintf("Updated %s (backup: %s)", targetPath, result.BackupPath)
	} else {
		result.Message = fmt.Sprintf("Updated %s", targetPath)
	}
	return result, nil
}
