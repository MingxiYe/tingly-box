import { IconButton, Link, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Close, GitHub, Star } from '@/components/icons';
import { setSyncedItem } from '@/services/uiPrefs';

const REPO_URL = 'https://github.com/tingly-dev/tingly-box';
// When the banner was last closed on an agent page (epoch ms). Synced through
// services/uiPrefs so closing it in the browser also counts in the desktop
// window.
export const STAR_BANNER_DISMISSED_AT_KEY = 'layout.githubStarBanner.dismissedAt';
// A closed banner stays away this long, then comes back.
const DISMISS_FOR_MS = 3 * 24 * 60 * 60 * 1000;

const isSnoozed = (): boolean => {
    try {
        const at = Number(localStorage.getItem(STAR_BANNER_DISMISSED_AT_KEY));
        return at > 0 && Date.now() - at < DISMISS_FOR_MS;
    } catch {
        return false;
    }
};

// Asks the user to star the repo. Rendered by Layout on /agent and every
// agent page: closable; closing hides it on all of them for three days, then
// it returns. Other pages don't show it. `persistent` (no close button) is
// kept for a placement that must always show; none uses it today.
//
// Styled as a plain surface card (paper bg + divider border) rather than a
// MUI Alert, so it reads as part of the app chrome instead of a status/info
// message with its own fixed hue.
export const GitHubStarBanner = ({ persistent = false }: { persistent?: boolean }) => {
    const { t } = useTranslation();
    const [dismissed, setDismissed] = useState(() => !persistent && isSnoozed());

    // The post-sign-in sync may bring in a dismissal made on the other surface.
    useEffect(() => {
        if (persistent) return;
        const onStorage = (e: StorageEvent) => {
            if (e.key === STAR_BANNER_DISMISSED_AT_KEY) setDismissed(isSnoozed());
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [persistent]);

    if (dismissed) return null;

    const handleDismiss = () => {
        setSyncedItem(STAR_BANNER_DISMISSED_AT_KEY, String(Date.now()));
        setDismissed(true);
    };

    return (
        <Stack
            direction="row"
            spacing={1.5}
            sx={{
                alignItems: 'center',
                px: 2,
                py: 1,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.paper',
            }}
        >
            <Star sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
            <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
                {t('layout.githubStarBanner.text')}{' '}
                <Link
                    href={REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    color="primary"
                    sx={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 0.5, verticalAlign: 'middle' }}
                >
                    <GitHub sx={{ fontSize: 15 }} />
                    {t('layout.githubStarBanner.cta')}
                </Link>
            </Typography>
            {!persistent && (
                <IconButton
                    size="small"
                    aria-label={t('common.dismiss')}
                    onClick={handleDismiss}
                    sx={{ color: 'text.secondary' }}
                >
                    <Close sx={{ fontSize: 18 }} />
                </IconButton>
            )}
        </Stack>
    );
};
