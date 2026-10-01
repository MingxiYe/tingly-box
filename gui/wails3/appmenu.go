package main

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	repoURL     = "https://github.com/tingly-dev/tingly-box"
	newIssueURL = repoURL + "/issues/new/choose"
	settingsKey = "CmdOrCtrl+,"
	showHubKey  = "CmdOrCtrl+Shift+H"
	reloadKey   = "CmdOrCtrl+R"
	devToolsKey = "CmdOrCtrl+Alt+I"
	goAgentKey  = "CmdOrCtrl+1"
	goDashKey   = "CmdOrCtrl+2"
	goCredsKey  = "CmdOrCtrl+3"
	goLogsKey   = "CmdOrCtrl+4"
)

// useAppMenu installs the macOS menu bar. Without it Wails falls back to a
// generic menu with no way into the app's pages; this one adds Settings… (⌘,)
// and a Go menu whose ⌘1–4 mirror the rail, all landing through the same
// openMain as the tray and the hub panel. Windows/Linux have no global menu
// bar — Wails would attach this to each window instead — so they keep none.
func useAppMenu(app *application.App, openMain func(path string), debug bool) {
	if runtime.GOOS != "darwin" {
		return
	}

	menu := app.Menu.New()

	appMenu := menu.AddSubmenu(AppName)
	appMenu.AddRole(application.About)
	appMenu.AddSeparator()
	appMenu.Add("Settings…").SetAccelerator(settingsKey).OnClick(func(*application.Context) { openMain(RouteSystem) })
	appMenu.AddSeparator()
	appMenu.AddRole(application.Hide)
	appMenu.AddRole(application.HideOthers)
	appMenu.AddRole(application.ShowAll)
	appMenu.AddSeparator()
	appMenu.AddRole(application.Quit)

	// Edit keeps ⌘C/⌘V/⌘A working in the webview: on macOS those shortcuts
	// are menu items, so without the role there is no copy or paste.
	menu.AddRole(application.EditMenu)

	goMenu := menu.AddSubmenu("Go")
	goMenu.Add("Agent").SetAccelerator(goAgentKey).OnClick(func(*application.Context) { openMain(RouteAgent) })
	goMenu.Add("Dashboard").SetAccelerator(goDashKey).OnClick(func(*application.Context) { openMain(RouteDashboard) })
	goMenu.Add("Credentials").SetAccelerator(goCredsKey).OnClick(func(*application.Context) { openMain(RouteCredentials) })
	goMenu.Add("Logs").SetAccelerator(goLogsKey).OnClick(func(*application.Context) { openMain(RouteLogs) })
	goMenu.AddSeparator()
	goMenu.Add("Show Hub").SetAccelerator(showHubKey).OnClick(func(*application.Context) { SystemTray.ToggleWindow() })

	viewMenu := menu.AddSubmenu("View")
	viewMenu.Add("Reload").SetAccelerator(reloadKey).OnClick(func(*application.Context) {
		if w := app.Window.Current(); w != nil {
			w.Reload()
		}
	})
	if debug {
		viewMenu.Add("Developer Tools").SetAccelerator(devToolsKey).OnClick(func(*application.Context) {
			if w := app.Window.Current(); w != nil {
				w.OpenDevTools()
			}
		})
	}
	viewMenu.AddSeparator()
	viewMenu.AddRole(application.ToggleFullscreen)

	menu.AddRole(application.WindowMenu)

	helpMenu := menu.AddSubmenu("Help")
	helpMenu.Add("GitHub").OnClick(func(*application.Context) { _ = app.Browser.OpenURL(repoURL) })
	helpMenu.Add("Report an Issue").OnClick(func(*application.Context) { _ = app.Browser.OpenURL(newIssueURL) })

	app.Menu.Set(menu)
}
