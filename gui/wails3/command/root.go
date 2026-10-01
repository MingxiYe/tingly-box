package command

import (
	"github.com/tingly-dev/tingly-box/internal/app"
	"github.com/tingly-dev/tingly-box/internal/command/options"
)

// AppLauncher defines the interface for launching the GUI application.
// There is a single unified mode: server + tray (with hub panel) + main
// window. The former gui/slim/tray subcommand split is gone.
type AppLauncher interface {
	Start(appManager *app.AppManager, opts options.StartServerOptions) error
}
