// Pages the desktop shell's tray hub panel jumps the main window to. Kept out
// of HubPage so routes.contract.test.tsx can check every one lands on a real
// page — same contract as the Go side's gui/wails3/routes.go.
export const SHELL_ROUTES = {
    agent: '/agent',
    dashboard: '/dashboard',
    credentials: '/credentials',
    logs: '/system/logs',
    system: '/system',
    quotaHistory: '/dashboard/quota-history',
} as const;
