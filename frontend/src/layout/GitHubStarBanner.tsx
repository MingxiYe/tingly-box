import { IconButton, Link, Stack, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Close, GitHub, Star } from '@/components/icons';

export const REPO_URL = 'https://github.com/tingly-dev/tingly-box';
// When the banner was last closed (epoch ms). Local to this browser / window
// on purpose: it's a nudge, not a preference worth syncing.
export const STAR_BANNER_DISMISSED_AT_KEY = 'layout.githubStarBanner.dismissedAt';
// A closed banner stays away this long, then comes back.
const DISMISS_FOR_MS = 4 * 24 * 60 * 60 * 1000;

const isSnoozed = (): boolean => {
    try {
        const at = Number(localStorage.getItem(STAR_BANNER_DISMISSED_AT_KEY));
        return at > 0 && Date.now() - at < DISMISS_FOR_MS;
    } catch {
        return false;
    }
};

// Asks the user to star the repo, on agent pages only (Layout renders it on
// /agent/*). Closable; closing hides it for four days, then it returns. The
// sidebar footer's "star" link stays as the always-there, quiet version.
//
// Styled as a plain surface card (paper bg + divider border) rather than a
// MUI Alert, so it reads as part of the app chrome instead of a status/info
// message with its own fixed hue.
export const GitHubStarBanner = () => {
    const { t } = useTranslation();
    const [dismissed, setDismissed] = useState(isSnoozed);

    // A close in another tab of the same browser counts here too.
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === STAR_BANNER_DISMISSED_AT_KEY) setDismissed(isSnoozed());
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    if (dismissed) return null;

    const handleDismiss = () => {
        try {
            localStorage.setItem(STAR_BANNER_DISMISSED_AT_KEY, String(Date.now()));
        } catch {
            // Storage blocked: it just closes for this page view.
        }
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
                {t('layout.githubStar.text')}{' '}
                <Link
                    href={REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    color="primary"
                    sx={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 0.5, verticalAlign: 'middle' }}
                >
                    <GitHub sx={{ fontSize: 15 }} />
                    {t('layout.githubStar.cta')}
                </Link>
            </Typography>
            <IconButton
                size="small"
                aria-label={t('common.dismiss')}
                onClick={handleDismiss}
                sx={{ color: 'text.secondary' }}
            >
                <Close sx={{ fontSize: 18 }} />
            </IconButton>
        </Stack>
    );
};
