package main

// Frontend routes the tray and app menus navigate to. The React router is the
// only thing that knows which paths exist, so these are checked from the
// frontend side: frontend/src/routes/routes.contract.test.tsx fails if any of
// them would fall through to the catch-all. Menu code must use these
// constants, never a raw "/..." literal (the same test enforces that).
const (
	RouteAgent       = "/agent"
	RouteDashboard   = "/dashboard"
	RouteCredentials = "/credentials"
	RouteLogs        = "/system/logs"
	RouteSystem      = "/system"
	RouteHub         = "/hub"
)
