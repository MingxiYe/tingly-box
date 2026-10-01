import { Box, Button, ClickAwayListener, Drawer, IconButton, Paper, Popper, Tooltip, Stack, Typography } from '@mui/material';
import { Menu as IconMenu, Visibility as IconVisibility, Check as IconCheck, tablerMui } from '@/components/icons';
import { IconLayoutSidebarLeftCollapse } from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import { Z_INDEX } from '../constants/zIndex';
import { activityBarWidth, sidebarWidth } from './constants';
import { mobileContentSx, mobileMenuButtonSx, mobileNavigationBarSx } from './styles';
import { ActivityBar } from './ActivityBar.tsx';
import { Sidebar } from './Sidebar';
import { useActivityItems } from './useActivityItems.tsx';
import { SidebarCollapsedProvider, useSidebarCollapsed } from './useSidebarCollapsed';
import type { ActivityItem, LayoutProps } from './types';
import { FloatingStatusIndicators } from '../components/FloatingStatusIndicators';
import { setSyncedItem, syncUiPrefs } from '../services/uiPrefs';
import { useHiddenScenarios } from '@/pages/scenario/scenarioRegistry';
import { rememberAgentPath } from '@/pages/scenario/lastAgent';
import type { NavItem } from './types';

// Outside edit mode hidden rows go, and so does any divider they leave
// leading, trailing or doubled.
// The eye in the Agent sidebar header introduces itself once: a callout
// pointing at it until the user closes it (or uses the eye). Synced so
// closing it in the browser also counts in the desktop window.
export const AGENT_VISIBILITY_TIP_KEY = 'layout.agentVisibilityTip.dismissed';
const readTipDismissed = () => {
    try {
        return localStorage.getItem(AGENT_VISIBILITY_TIP_KEY) === '1';
    } catch {
        return false;
    }
};

const withoutHidden = (items: NavItem[]): NavItem[] => {
    const kept = items.filter(item => item.type === 'divider' || !item.hidden);
    return kept.filter((item, i) => item.type !== 'divider'
        || (i > 0 && i < kept.length - 1 && kept[i + 1].type !== 'divider'));
};

const IconCollapseSidebar = tablerMui(IconLayoutSidebarLeftCollapse);

const MobileNavigationBar = ({ onMenuClick }: { onMenuClick: () => void }) => (
    <Box
        sx={mobileNavigationBarSx}
    >
        <IconButton
            color="primary"
            aria-label="Open navigation menu"
            onClick={onMenuClick}
            sx={mobileMenuButtonSx}
        >
            <IconMenu sx={{ fontSize: 24 }} />
        </IconButton>
    </Box>
);

const LayoutInner = ({ children }: LayoutProps) => {
    const { t } = useTranslation();
    const location = useLocation();
    const [mobileOpen, setMobileOpen] = useState(false);

    // Layout only renders after sign-in: bring this surface's UI prefs in
    // line with the server's (see services/uiPrefs.ts).
    useEffect(() => {
        void syncUiPrefs();
    }, []);

    const activityItems = useActivityItems();
    const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();

    const isActive = (path: string) => location.pathname === path;
    const isChildActive = (children?: ActivityItem['children']) =>
        children?.some(item => item.type !== 'divider' && (item.match ? item.match(location.pathname) : isActive(item.path))) ?? false;

    // Determine active activity from current path, falling back to localStorage
    const activeActivity = useMemo(() => {
        if (location.pathname === '/help') return 'help';
        for (const item of activityItems) {
            if (item.path && isActive(item.path)) return item.key;
            if (item.children && isChildActive(item.children)) return item.key;
        }
        // Check if saved activity is still valid
        const saved = sessionStorage.getItem('layout.activeActivity') || localStorage.getItem('layout.activeActivity');
        if (saved && activityItems.some(item => item.key === saved)) return saved;
        // Fallback to 'scenario' (which is valid - it's the agent activity)
        return 'scenario';
    }, [activityItems, location.pathname]);

    // Persist the active activity for cross-session boot. Each activity
    // re-opens at its defaultPath (the scenario activity opens its overview).
    useEffect(() => {
        sessionStorage.setItem('layout.activeActivity', activeActivity);
        localStorage.setItem('layout.activeActivity', activeActivity);
    }, [activeActivity, location.pathname]);

    // Agent pages are what /agent (the rail item and the landing) reopens.
    useEffect(() => {
        rememberAgentPath(location.pathname);
    }, [location.pathname]);

    // Edit mode of the Agent sidebar: every agent, hidden ones included,
    // each with its visibility toggle. It replaced the /agent card page.
    const [editingAgents, setEditingAgents] = useState(false);
    const { toggleHidden } = useHiddenScenarios();
    const [tipDismissed, setTipDismissed] = useState(readTipDismissed);
    // The header renders in both the desktop nav and the (kept-mounted)
    // mobile drawer; anchor the callout to whichever eye is on screen.
    const [eyeEl, setEyeEl] = useState<HTMLElement | null>(null);
    const eyeRef = useCallback((el: HTMLElement | null) => {
        if (el && el.offsetParent !== null) setEyeEl(el);
    }, []);
    const dismissTip = useCallback(() => {
        setTipDismissed(true);
        setSyncedItem(AGENT_VISIBILITY_TIP_KEY, '1');
    }, []);
    useEffect(() => {
        if (activeActivity !== 'scenario') setEditingAgents(false);
    }, [activeActivity]);

    const sidebarItems = useMemo(() => {
        const activity = activityItems.find(item => item.key === activeActivity);
        const children = activity?.children || [];
        const visible = withoutHidden(children);
        if (!editingAgents) return visible;
        // Edit mode lists hidden agents too, but after the visible ones
        // (behind a divider) rather than interleaved, so the shown list
        // still reads as the sidebar the user will get.
        const hidden = children.filter(item => item.type !== 'divider' && item.hidden);
        return hidden.length > 0 ? [...visible, { type: 'divider' as const }, ...hidden] : visible;
    }, [activityItems, activeActivity, editingAgents]);

    // A sidebar is a choice between pages; an activity with a single page
    // (Bench, or Prompt with one of its two flags on) has nothing to choose,
    // so its rail item goes straight to that page with no sidebar.
    const hasSidebar = sidebarItems.filter(item => item.type !== 'divider').length > 1;

    const activeActivityLabel = useMemo(() => {
        const activity = activityItems.find(item => item.key === activeActivity);
        return activity?.label || '';
    }, [activityItems, activeActivity]);

    // Navigation itself now happens via ActivityBar's own <RouterLink> (so
    // right-click "copy link"/"open in new tab" work on level-1 items), so
    // this only handles the side effects the click triggers alongside it.
    // With the sidebar collapsed, clicking a rail item that has pages to
    // choose between shows its sidebar as a flyout over the content, so the
    // pages stay one click away; picking one (or clicking elsewhere) closes it.
    const [flyoutOpen, setFlyoutOpen] = useState(false);

    const handleActivityClick = (item: ActivityItem) => {
        const hasSidebarItems = (item.children?.filter(child => child.type !== 'divider').length ?? 0) > 1;
        if (!hasSidebarItems) {
            setMobileOpen(false);
        }
        setFlyoutOpen(sidebarCollapsed && hasSidebarItems);

        sessionStorage.setItem('layout.activeActivity', item.key);
    };

    // Sidebar header actions: the collapse toggle always sits in the header
    // (it owns the Sidebar, so it lives on it). The scenario activity also
    // exposes a quick link to manage which agents are visible.
    const collapseButton = (
        <Tooltip title={t('layout.sidebar.collapse')} arrow placement="bottom">
            <IconButton
                size="small"
                onClick={toggleSidebar}
                aria-label={t('layout.sidebar.collapse')}
                sx={{
                    color: 'text.secondary',
                    '&:hover': { color: 'primary.main' },
                }}
            >
                <IconCollapseSidebar sx={{ fontSize: 18 }} />
            </IconButton>
        </Tooltip>
    );

    const sidebarHeaderAction = (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            {activeActivity === 'scenario' && (
                <Tooltip
                    title={editingAgents ? t('layout.sidebar.doneEditing') : t('scenarioOverview.editTooltip')}
                    arrow
                    placement="bottom"
                >
                    <IconButton
                        ref={eyeRef}
                        size="small"
                        onClick={() => {
                            setEditingAgents(v => !v);
                            if (!tipDismissed) dismissTip();
                        }}
                        aria-pressed={editingAgents}
                        aria-label={t('scenarioOverview.editTooltip')}
                        sx={{
                            color: editingAgents ? 'primary.main' : 'text.secondary',
                            '&:hover': { color: 'primary.main' },
                        }}
                    >
                        {editingAgents ? <IconCheck sx={{ fontSize: 16 }} /> : <IconVisibility sx={{ fontSize: 16 }} />}
                    </IconButton>
                </Tooltip>
            )}
            {collapseButton}
        </Stack>
    );

    const showTip = !tipDismissed && activeActivity === 'scenario' && hasSidebar && !sidebarCollapsed && !!eyeEl && eyeEl.isConnected;
    const visibilityTip = (
        <Popper
            open={showTip}
            anchorEl={eyeEl}
            placement="right-start"
            modifiers={[{ name: 'offset', options: { offset: [-8, 14] } }]}
            sx={{ zIndex: Z_INDEX.drawer + 3 }}
        >
            <Paper
                elevation={6}
                sx={{
                    position: 'relative',
                    width: 260,
                    p: 1.75,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'primary.main',
                    // Arrow pointing back at the eye.
                    '&::before': {
                        content: '""',
                        position: 'absolute',
                        left: -7,
                        top: 14,
                        width: 12,
                        height: 12,
                        bgcolor: 'background.paper',
                        borderLeft: '1px solid',
                        borderBottom: '1px solid',
                        borderColor: 'primary.main',
                        transform: 'rotate(45deg)',
                    },
                }}
            >
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    {t('layout.sidebar.visibilityTipTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {t('layout.sidebar.visibilityTip')}
                </Typography>
                <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
                    <Button size="small" variant="contained" disableElevation onClick={dismissTip}>
                        {t('layout.sidebar.visibilityTipGotIt')}
                    </Button>
                </Stack>
            </Paper>
        </Popper>
    );

    const navigationContent = (
        <Box data-nav-rail sx={{ display: 'flex', height: '100%', position: 'relative' }}>
            <ActivityBar
                activityItems={activityItems}
                activeActivity={activeActivity}
                onActivityClick={handleActivityClick}
                onStandaloneNavigate={() => setMobileOpen(false)}
            />
            {hasSidebar && !sidebarCollapsed && (
                <Sidebar
                    sidebarItems={sidebarItems}
                    activeActivityLabel={activeActivityLabel}
                    onClose={() => setMobileOpen(false)}
                    headerAction={sidebarHeaderAction}
                    editing={editingAgents}
                    onToggleHidden={toggleHidden}
                />
            )}
            {hasSidebar && sidebarCollapsed && flyoutOpen && (
                <ClickAwayListener
                    onClickAway={(e) => {
                        // The rail's own clicks decide open/closed themselves.
                        if ((e.target as Element | null)?.closest?.('[data-nav-rail]')) return;
                        setFlyoutOpen(false);
                    }}
                >
                    <Box sx={{ position: 'absolute', left: '100%', top: 0, bottom: 0, zIndex: Z_INDEX.drawer + 2, boxShadow: 8, bgcolor: 'background.paper' }}>
                        <Sidebar
                            sidebarItems={sidebarItems}
                            activeActivityLabel={activeActivityLabel}
                            onClose={() => { setFlyoutOpen(false); setMobileOpen(false); }}
                            headerAction={sidebarHeaderAction}
                            editing={editingAgents}
                            onToggleHidden={toggleHidden}
                        />
                    </Box>
                </ClickAwayListener>
            )}
        </Box>
    );

    return (
        <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden', position: 'relative', zIndex: Z_INDEX.main }}>
            <FloatingStatusIndicators />
            {visibilityTip}

            {/* Desktop nav */}
            <Box component="nav" sx={{ display: { xs: 'none', md: 'flex' }, height: '100%', position: 'relative', zIndex: Z_INDEX.drawer + 1 }}>
                {navigationContent}
            </Box>

            {/* Mobile Drawer */}
            <Drawer
                variant="temporary"
                open={mobileOpen}
                onClose={() => setMobileOpen(false)}
                ModalProps={{ keepMounted: true }}
                sx={{
                    display: { xs: 'block', md: 'none' },
                    '& .MuiDrawer-paper': {
                        boxSizing: 'border-box',
                        width: hasSidebar ? activityBarWidth + sidebarWidth : activityBarWidth,
                        zIndex: Z_INDEX.drawer,
                    },
                }}
            >
                {navigationContent}
            </Drawer>

            <MobileNavigationBar onMenuClick={() => setMobileOpen(!mobileOpen)} />

            {/* Main content */}
            <Box
                component="main"
                sx={{ flexGrow: 1, height: '100vh', display: 'flex', flexDirection: 'column', overflowX: 'hidden', position: 'relative', zIndex: 1 }}
            >
                <Box sx={mobileContentSx}>
                    {children ?? <Outlet />}
                </Box>
            </Box>

        </Box>
    );
};

// The collapse state is shared between ActivityBar (toggle) and the Sidebar
// slot here, so the provider is mounted at the Layout boundary — both children
// consume the same context.
const Layout = ({ children }: LayoutProps) => (
    <SidebarCollapsedProvider>
        <LayoutInner>{children}</LayoutInner>
    </SidebarCollapsedProvider>
);

export default Layout;
