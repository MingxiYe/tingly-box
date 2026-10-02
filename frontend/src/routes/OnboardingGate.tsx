import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '@/services/api';
import { isCredentialProvider } from '@/utils/providers';

// OnboardingGate decides where a freshly-authenticated user lands. Brand-new
// installs (no provider configured) get sent to /help — the lightbulb Help
// page, whose ProvidersCard is the browsable "add your first provider"
// experience (the old standalone Onboarding page's content, now a card
// there instead of a page of its own); everyone else lands on /agent, which
// opens the agent page they were last on. We hit /api/v2/providers once on mount; while in
// flight we render nothing to avoid a flash of the default agent page.
const OnboardingGate: React.FC = () => {
    const [target, setTarget] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const result = await api.getProviders();
                if (cancelled) return;
                const providers = Array.isArray(result?.data) ? result.data : [];
                if (result?.success && !providers.some(isCredentialProvider)) {
                    setTarget('/help');
                    localStorage.removeItem('layout.activeActivity');
                    sessionStorage.removeItem('layout.activeActivity');
                    return;
                }
            } catch {
                // Swallow the error and fall through to the default agent —
                // failing the gate should never lock the user out of the app.
            }
            // Clear stale activity state and open the last agent
            localStorage.removeItem('layout.activeActivity');
            sessionStorage.removeItem('layout.activeActivity');
            if (!cancelled) setTarget('/agent');
        })();
        return () => { cancelled = true; };
    }, []);

    if (target === null) return null;
    return <Navigate to={target} replace />;
};

export default OnboardingGate;
