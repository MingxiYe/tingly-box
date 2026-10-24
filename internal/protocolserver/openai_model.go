package protocolserver

import (
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/sirupsen/logrus"

	"github.com/tingly-dev/tingly-box/internal/config"
	"github.com/tingly-dev/tingly-box/internal/typ"
)

// OpenAIModel represents a model in OpenAI's models API format
type OpenAIModel struct {
	ID          string `json:"id"`
	Object      string `json:"object"`
	Created     int64  `json:"created"`
	OwnedBy     string `json:"owned_by"`
	Description string `json:"description,omitempty"` // Model description
	Context     int    `json:"context,omitempty"`     // Max context window
	MaxOutput   int    `json:"max_output,omitempty"`  // Max output tokens
	// ContextWindow is the context window the vendor publishes (Tingly Box's
	// own field, in both listings). MaxInputTokens / MaxTokens follow the
	// names and meaning of Anthropic's Models API (OpenAI's Model object has
	// no such fields): the most input one request may carry, which is below
	// ContextWindow when the vendor's window counts output too (gpt-5: 400K
	// window, 272K input), and the most output.
	ContextWindow  int `json:"context_window,omitempty"`
	MaxInputTokens int `json:"max_input_tokens,omitempty"`
	MaxTokens      int `json:"max_tokens,omitempty"`
	// MaxContextWindow is on the Codex list only (Tingly Box's own field,
	// named after Codex's catalog): how far Codex may raise max_input_tokens
	// for this model, when that is above it.
	MaxContextWindow int `json:"max_context_window,omitempty"`
	// AuthType reflects the primary backing provider's auth type. It is
	// non-standard (OpenAI's models API has no such field) and consumed by
	// the tingly-box frontend to order model picker entries:
	// oauth -> api_key -> vmodel.
	AuthType string `json:"auth_type,omitempty"`
}

// OpenAIModelsResponse represents OpenAI's models API response format
type OpenAIModelsResponse struct {
	Object string        `json:"object"`
	Data   []OpenAIModel `json:"data"`
}

// HandleOpenAIListModels handles the /v1/models endpoint (OpenAI compatible)
func (ph *ProtocolHandler) HandleOpenAIListModels(c *gin.Context) {
	ph.openAIListModelsWithScenario(c, nil)
}

// OpenAIListModelsForScenario handles scenario-scoped model listing for OpenAI format
func (ph *ProtocolHandler) OpenAIListModelsForScenario(c *gin.Context, scenario typ.RuleScenario) {
	ph.openAIListModelsWithScenario(c, &scenario)
}

func (ph *ProtocolHandler) openAIListModelsWithScenario(c *gin.Context, scenario *typ.RuleScenario) {
	cfg := ph.deps.Config
	if cfg == nil {
		writeErrorResponse(c, http.StatusInternalServerError, ErrorResponse{
			Error: ErrorDetail{
				Message: "Config not available",
				Type:    "internal_error",
			},
		})
		return
	}

	rules := cfg.GetRequestConfigs()

	var models []OpenAIModel
	for _, rule := range rules {
		if !rule.Active {
			continue
		}
		if scenario != nil && !ShouldIncludeRuleInModelList(*scenario, rule.GetScenario()) {
			continue
		}

		// Get timestamp from provider's LastUpdated field
		var created int64
		services := rule.GetServices()

		for i := range services {
			svc := services[i]
			// Skip nil services (defensive check after DB migration)
			if svc == nil {
				logrus.Debugf("Skipping nil service in rule %s during model list", rule.UUID)
				continue
			}
			if svc.Active {
				provider, err := cfg.GetProviderByUUID(svc.Provider)
				if err == nil {
					// Parse LastUpdated timestamp if available
					if provider.LastUpdated != "" {
						if t, err := time.Parse(time.RFC3339, provider.LastUpdated); err == nil {
							created = t.Unix()
						}
					}
				}
			}
		}

		// owned_by is always "tingly-box" — never disclose the upstream
		// provider name here.
		ownedBy := "tingly-box"

		// Model details come from the catalog entry of the upstream model
		// this rule routes to.
		info, _ := ruleModelInfo(cfg, rule)

		model := OpenAIModel{
			ID:             rule.RequestModel,
			Object:         "model",
			Created:        created,
			OwnedBy:        ownedBy,
			Description:    info.Description,
			Context:        info.Context,
			MaxOutput:      info.MaxOutput,
			ContextWindow:  info.Context,
			MaxInputTokens: info.InputLimit(),
			MaxTokens:      info.MaxOutput,
			AuthType:       string(PrimaryAuthTypeForRule(cfg, rule)),
		}
		if scenario != nil && *scenario == typ.ScenarioCodex {
			setCodexWindow(&model, cfg.CodexAutoContextWindow(rule))
		}
		models = append(models, model)
	}

	sort.SliceStable(models, func(i, j int) bool {
		return AuthTypeSortWeight(typ.AuthType(models[i].AuthType)) <
			AuthTypeSortWeight(typ.AuthType(models[j].AuthType))
	})

	c.JSON(http.StatusOK, OpenAIModelsResponse{
		Object: "list",
		Data:   models,
	})
}

// setCodexWindow makes a Codex list entry say what the rule's "Auto" context
// window tells Codex: max_input_tokens is that window, which is the route's
// input limit rather than the catalog's (a Claude model on an Anthropic-style
// endpoint takes 200K without the 1M header the rule's 1M flag adds, and 1M
// with it), and max_context_window the ceiling Codex may raise it to. Where
// that opens more than the catalog's published window, context_window (and
// context) follow, so max_input_tokens never exceeds them. A model whose
// window is only a guess carries neither, as an unknown one does elsewhere.
// The Context chip in the rule editor reads these fields.
func setCodexWindow(m *OpenAIModel, w config.CodexContextWindow) {
	m.MaxInputTokens, m.MaxContextWindow = 0, 0
	if !w.Known() {
		return
	}
	m.MaxInputTokens = w.Window
	if w.Max > w.Window {
		m.MaxContextWindow = w.Max
	}
	if m.ContextWindow < w.Window {
		m.ContextWindow, m.Context = w.Window, w.Window
	}
}

// ListModelsByScenario handles the /v1/models endpoint for scenario-based routing
func (ph *ProtocolHandler) ListModelsByScenario(c *gin.Context) {
	scenario := c.Param("scenario")

	// Convert string to RuleScenario and validate
	scenarioType := typ.RuleScenario(scenario)
	if !IsValidRuleScenario(scenarioType) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": gin.H{
				"message": fmt.Sprintf("invalid scenario: %s", scenario),
				"type":    "invalid_request_error",
			},
		})
		return
	}

	// Route to appropriate handler based on scenario
	switch scenarioType.Base() {
	case typ.ScenarioAnthropic, typ.ScenarioClaudeCode, typ.ScenarioClaudeDesktop:
		ph.AnthropicListModelsForScenario(c, scenarioType)
	default:
		// OpenAI is the default
		ph.OpenAIListModelsForScenario(c, scenarioType)
	}
}
