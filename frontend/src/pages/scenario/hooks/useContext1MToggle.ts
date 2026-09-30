import { useState } from 'react';

/**
 * Shared context-1M toggle plumbing for scenario pages: TemplatePage's
 * onContext1MToggle stores the pending change and opens the config panel so
 * the user can apply the matching env update; the panel clears it on close.
 *
 * The toggled rule is kept too, for panels that scope the change to it
 * (Claude Code); the others only read the boolean.
 */
export const useContext1MToggle = (openConfigPanel: () => void) => {
    const [pendingContext1MChange, setPendingContext1MChange] = useState<boolean | null>(null);
    const [pendingContext1MRuleUuid, setPendingContext1MRuleUuid] = useState<string | undefined>(undefined);

    const handleContext1MToggle = (newState: boolean, ruleUuid?: string) => {
        // Store the pending change and directly open config panel
        setPendingContext1MChange(newState);
        setPendingContext1MRuleUuid(ruleUuid);
        openConfigPanel();
    };

    const clearPendingContext1MChange = () => {
        setPendingContext1MChange(null);
        setPendingContext1MRuleUuid(undefined);
    };

    return { pendingContext1MChange, pendingContext1MRuleUuid, handleContext1MToggle, clearPendingContext1MChange };
};
