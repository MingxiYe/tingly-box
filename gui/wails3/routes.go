package main

// Frontend routes the tray menus navigate to. The React router is the only
// thing that knows which paths exist, so these are checked from the frontend
// side: frontend/src/routes/routes.contract.test.tsx fails if any of them
// would fall through to the catch-all. Tray code must use these constants,
// never a raw "/..." literal (the same test enforces that).
const (
	RouteLanding    = "/"
	RouteDashboard  = "/dashboard"
	RouteOpenAI     = "/agent/openai"
	RouteAnthropic  = "/agent/anthropic"
	RouteClaudeCode = "/agent/claude_code"
)
