package config

import (
	"context"
	"strings"

	"github.com/tingly-dev/tingly-box/internal/catalog"
	"github.com/tingly-dev/tingly-box/internal/typ"
)

// RuleModelInfo returns the provider catalog's details for the model(s) an
// active rule routes to: the description of the first upstream the catalog
// knows, and per numeric field the smallest known value across upstreams, so
// the result is safe for whichever one serves the request (see ruleUpstreams
// for which count). The template is matched from the provider itself (never
// its user-chosen name) and looked up by the service's upstream model, then by
// the rule's request model for rules that keep the upstream name. ok is false
// when no upstream is known. MaxContext is kept only when one upstream is
// known: templates count it differently (with or without output), so the
// Codex window merges it per upstream instead (CodexAutoContextWindow).
//
// It is the one place a rule's model metadata is resolved: /v1/models and the
// management model listing read it, and the Codex window reads the same
// upstreams (ruleUpstreams, upstreamModelInfo).
func (c *Config) RuleModelInfo(rule typ.Rule) (info catalog.ModelInfo, ok bool) {
	upstreams := c.ruleUpstreams(rule)
	if len(upstreams) == 0 {
		return info, false
	}
	tm := c.modelCatalog()
	for _, up := range upstreams {
		_, m, found := upstreamModelInfo(tm, up, rule.RequestModel)
		if !found {
			continue
		}
		if !ok {
			info, ok = m, true
			continue
		}
		info.Context = smallestKnown(info.Context, m.Context)
		info.MaxInput = smallestKnown(info.InputLimit(), m.InputLimit())
		info.MaxOutput = smallestKnown(info.MaxOutput, m.MaxOutput)
		info.MaxContext = 0
	}
	return info, ok
}

// ruleUpstream is one upstream a rule can send a request to: a provider and
// the service's upstream model ("" when the service keeps the request model).
type ruleUpstream struct {
	provider *typ.Provider
	model    string
}

// ruleUpstreams lists the upstreams a rule can reach: its active services and,
// with smart routing on, each route's. Services on a disabled or deleted
// provider never answer and are left out.
func (c *Config) ruleUpstreams(rule typ.Rule) []ruleUpstream {
	services := rule.GetServices()
	if rule.SmartEnabled {
		for _, route := range rule.SmartRouting {
			services = append(services[:len(services):len(services)], route.Services...)
		}
	}
	var out []ruleUpstream
	for _, svc := range services {
		if svc == nil || !svc.Active {
			continue
		}
		provider, err := c.GetProviderByUUID(svc.Provider)
		if err != nil || provider == nil || !provider.Enabled {
			continue
		}
		out = append(out, ruleUpstream{provider: provider, model: svc.Model})
	}
	return out
}

// upstreamModelInfo looks an upstream's model up on its provider's matched
// template: the service's model, then the request model for rules that keep
// the upstream name. model is the name that was found, else the one the
// request goes out with.
func upstreamModelInfo(tm *catalog.ProviderCatalogManager, up ruleUpstream, requestModel string) (model string, info catalog.ModelInfo, ok bool) {
	requestModel = strings.TrimSpace(requestModel)
	model = up.model
	if model == "" {
		model = requestModel
	}
	if tm == nil {
		return model, catalog.ModelInfo{}, false
	}
	if info, ok = tm.GetModelInfoForProvider(up.provider, up.model); ok {
		return up.model, info, true
	}
	if info, ok = tm.GetModelInfoForProvider(up.provider, requestModel); ok {
		return requestModel, info, true
	}
	return model, catalog.ModelInfo{}, false
}

// modelCatalog is the provider catalog rule metadata is read from: the
// server's template manager, or for a Config loaded without one (the CLI and
// TUI agent apply) the last catalog the server synced, else the embedded one,
// so every path resolves a rule the same way.
func (c *Config) modelCatalog() *catalog.ProviderCatalogManager {
	if tm := c.GetTemplateManager(); tm != nil {
		return tm
	}
	c.localCatalogOnce.Do(func() {
		tm := catalog.NewProviderCatalogManager(catalog.LastSynced())
		if tm.Initialize(context.Background()) == nil {
			c.localCatalog = tm
		}
	})
	return c.localCatalog
}

// smallestKnown is the smaller of two values, treating 0 as unknown.
func smallestKnown(a, b int) int {
	switch {
	case a <= 0:
		return b
	case b <= 0:
		return a
	default:
		return min(a, b)
	}
}
