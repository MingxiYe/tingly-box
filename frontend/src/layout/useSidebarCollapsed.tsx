import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import type { ReactNode } from 'react';

// Persisted "is the secondary Sidebar collapsed?" preference. Mirrors the
// ThemeContext pattern (module-level storage key, lazy read, persist-on-change
// effect, Context + guarded hook). Scoped to the layout area: the provider is
// mounted inside <Layout/>, so this hook is only meaningful there.

const STORAGE_KEY = 'layout.sidebarCollapsed';

// Desktop layouts narrower than this (a Wails window at its default size, a
// half-screen browser) start with the sidebar collapsed, so the content keeps
// its width; its pages are still one click away through the rail flyout.
// Below MUI's md breakpoint the whole nav is a drawer, so this doesn't apply.
const NARROW_DESKTOP_QUERY = '(min-width:900px) and (max-width:1199.95px)';

interface SidebarCollapsedValue {
    collapsed: boolean;
    toggle: () => void;
    setCollapsed: (next: boolean) => void;
}

const SidebarCollapsedContext = createContext<SidebarCollapsedValue | undefined>(undefined);

interface SidebarCollapsedProviderProps {
    children: ReactNode;
}

export const SidebarCollapsedProvider = ({ children }: SidebarCollapsedProviderProps) => {
    const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(STORAGE_KEY) === 'true');
    const narrow = useMediaQuery(NARROW_DESKTOP_QUERY);
    // Expanding by hand in a narrow window lasts for this session only — the
    // saved preference is about wide windows.
    const [expandedWhileNarrow, setExpandedWhileNarrow] = useState(false);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, String(collapsed));
    }, [collapsed]);

    const effective = narrow ? !expandedWhileNarrow : collapsed;

    const value = useMemo<SidebarCollapsedValue>(
        () => ({
            collapsed: effective,
            toggle: () => (narrow ? setExpandedWhileNarrow((prev) => !prev) : setCollapsed((prev) => !prev)),
            setCollapsed: (next: boolean) => (narrow ? setExpandedWhileNarrow(!next) : setCollapsed(next)),
        }),
        [effective, narrow],
    );

    return <SidebarCollapsedContext.Provider value={value}>{children}</SidebarCollapsedContext.Provider>;
};

export const useSidebarCollapsed = (): SidebarCollapsedValue => {
    const context = useContext(SidebarCollapsedContext);
    if (!context) {
        throw new Error('useSidebarCollapsed must be used within a SidebarCollapsedProvider');
    }
    return context;
};
