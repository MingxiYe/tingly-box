import { Person as IconUser, ChevronRight as IconChevronRight, Lightbulb as IconLightbulb } from '@/components/icons';
import { Box, Divider, IconButton, ListItemButton, ListItemIcon, Tooltip, Typography } from '@mui/material';
import React, { useState } from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVersion as useAppVersion } from '../contexts/VersionContext';
import {
    activityBarWidth,
    footerHeight,
} from './constants';
import {
    activityBottomClusterSx,
    activityBottomItemSx,
    activityExpandHandleSx,
    activityIconsScrollSx,
    activityItemSx,
    activityLogoButtonSx,
    activityLogoCellSx,
    activityRailSx,
} from './styles';
import { useSidebarCollapsed } from './useSidebarCollapsed';
import type { ActivityItem } from './types';
import { PreferencesMenu } from './PreferencesMenu';

interface ActivityBarProps {
    activityItems: ActivityItem[];
    activeActivity: string;
    onActivityClick: (item: ActivityItem) => void;
    onStandaloneNavigate?: () => void;
}

export const ActivityBar: React.FC<ActivityBarProps> = ({
    activityItems,
    activeActivity,
    onActivityClick,
    onStandaloneNavigate,
}) => {
    const { t } = useTranslation();
    const location = useLocation();
    const { currentVersion } = useAppVersion();
    const [preferencesAnchorEl, setPreferencesAnchorEl] = useState<HTMLElement | null>(null);
    const isHelpActive = location.pathname === '/help';
    const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebarCollapsed();

    return (
        <Box
            sx={{ width: activityBarWidth, ...activityRailSx }}
        >
            {/* Expand handle — only when the Sidebar is collapsed. Sits at the
                logo divider's right end so it aligns with the collapse button in
                the Sidebar header (the two form a symmetric pair). */}
            {sidebarCollapsed && (
                <Tooltip title={t('layout.sidebar.expand')} placement="right" arrow>
                    <IconButton
                        onClick={toggleSidebar}
                        aria-label={t('layout.sidebar.expand')}
                        sx={activityExpandHandleSx}
                    >
                        <IconChevronRight sx={{ fontSize: 18 }} />
                    </IconButton>
                </Tooltip>
            )}
            {/* Logo */}
            <Box sx={activityLogoCellSx}>
                <Tooltip title={`Tingly-Box v${currentVersion}`} placement="right" arrow>
                    <Box
                        component="a"
                        href="https://github.com/tingly-dev/tingly-box"
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={activityLogoButtonSx}
                    >
                        <Box
                            component="img"
                            src="/assets/icon.svg"
                            alt="Tingly-Box"
                            sx={{ width: 36, height: 36, borderRadius: 8 }}
                        />
                    </Box>
                </Tooltip>
            </Box>

            {/* Activity Icons */}
            <Box sx={activityIconsScrollSx}>
                {activityItems.map((item) => {
                    const isActiveItem = activeActivity === item.key;
                    const shortLabel = item.label.length > 12 ? item.label.slice(0, 7) + '…' : item.label;
                    // Mirrors Layout.handleActivityClick's own targetPath logic, so the
                    // rendered href always matches where a click would actually navigate —
                    // even for activities that own a level-2 sidebar (item.children).
                    const firstNavChild = item.children?.find((c) => c.type !== 'divider');
                    const targetPath = item.defaultPath || item.path || firstNavChild?.path;

                    return (
                        <ListItemButton
                            key={item.key}
                            component={targetPath ? RouterLink : 'div'}
                            to={targetPath}
                            onClick={() => onActivityClick(item)}
                            sx={activityItemSx({
                                '&:hover': {
                                    bgcolor: isActiveItem ? 'primary.main' : 'action.hover',
                                    color: isActiveItem ? 'primary.contrastText' : 'primary.main',
                                },
                                ...(isActiveItem && {
                                    bgcolor: 'primary.main',
                                    color: 'primary.contrastText',
                                }),
                            })}
                        >
                            <ListItemIcon sx={{ minWidth: 0, color: 'inherit', justifyContent: 'center' }}>
                                {item.icon}
                            </ListItemIcon>
                            <Typography
                                variant="caption"
                                sx={{
                                    fontWeight: isActiveItem ? 600 : 400,
                                    color: 'inherit',
                                    textAlign: 'center',
                                    lineHeight: 1.2,
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {shortLabel}
                            </Typography>
                        </ListItemButton>
                    );
                })}

                <Divider sx={{ mx: 2, my: 1 }} />

                {/* Help — the onboarding front door now (replaces the old
                    standalone "Quick Add Provider" wand in this exact slot).
                    Opens the lightbulb Help page: a small, growing set of
                    easy-to-miss useful actions (desktop shortcut, browse &
                    connect providers, ...), not a single-purpose shortcut to
                    one flow. */}
                    <Tooltip title={t('layout.help', { defaultValue: 'Tips & Help' })} placement="right" arrow>
                        <ListItemButton
                            component={RouterLink}
                            to="/help"
                            onClick={onStandaloneNavigate}
                            sx={activityItemSx({
                                '&:hover': {
                                    bgcolor: isHelpActive ? 'primary.main' : 'action.hover',
                                    color: isHelpActive ? 'primary.contrastText' : 'primary.main',
                                },
                                ...(isHelpActive && {
                                    bgcolor: 'primary.main',
                                    color: 'primary.contrastText',
                                }),
                            })}
                        >
                            <ListItemIcon sx={{ minWidth: 0, color: 'inherit', justifyContent: 'center' }}>
                                <IconLightbulb sx={{ fontSize: 22 }} />
                            </ListItemIcon>
                            <Typography
                                variant="caption"
                                sx={{
                                    fontWeight: isHelpActive ? 600 : 400,
                                    color: 'inherit',
                                    textAlign: 'center',
                                    lineHeight: 1.2,
                                }}
                            >
                                {t('layout.helpShort', { defaultValue: 'Help' })}
                            </Typography>
                        </ListItemButton>
                    </Tooltip>

            </Box>

            {/* Bottom: User icon */}
            <Box
                sx={{
                    py: 0.5,
                    borderTop: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    gap: 0.5,
                    height: footerHeight,
                }}
            >
                {/* Preferences: language, theme, feedback, version */}
                <Tooltip title={t('layout.activityBar.preferences')} placement="right" arrow>
                    <ListItemButton
                        onClick={(e) => setPreferencesAnchorEl(e.currentTarget)}
                        aria-label={t('layout.activityBar.preferences')}
                        sx={activityBottomItemSx({
                            '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
                        })}
                    >
                        <ListItemIcon sx={{ minWidth: 0, color: 'inherit', justifyContent: 'center' }}>
                            <IconUser sx={{ fontSize: 20 }} />
                        </ListItemIcon>
                    </ListItemButton>
                </Tooltip>
                <PreferencesMenu anchorEl={preferencesAnchorEl} onClose={() => setPreferencesAnchorEl(null)} />
            </Box>
        </Box>
    );
};
