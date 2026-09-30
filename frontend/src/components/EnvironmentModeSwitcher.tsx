import { Laptop as LaptopIcon } from '@/components/icons';
import { ChoiceToggle } from './ChoiceToggle';
import React from 'react';
import DockerOriginal from 'devicons-react/icons/DockerOriginal';

// ============================================================================
// Types
// ============================================================================

export type EnvironmentMode = 'local' | 'docker' | 'cli' | 'npx' | 'wsl';

export interface EnvironmentModeOption {
    value: EnvironmentMode;
    label: string;
    tooltip: string;
    icon: React.ReactElement;
}

// ============================================================================
// Default Mode Options
// ============================================================================

const DEFAULT_MODES: EnvironmentModeOption[] = [
    {
        value: 'local',
        label: 'Local',
        tooltip: 'Local mode - use localhost or 127.0.0.1',
        icon: <LaptopIcon fontSize="small" />,
    },
    {
        value: 'docker',
        label: 'Docker',
        tooltip: 'Docker mode - use host.docker.internal for container access',
        icon: <DockerOriginal size={20} color="blue" />,
    },
];

// ============================================================================
// Props
// ============================================================================

interface EnvironmentModeSwitcherProps {
    /** Current active mode */
    value: EnvironmentMode;
    /** Callback when mode changes */
    onChange: (mode: EnvironmentMode) => void;
    /** Available mode options (defaults to local + docker).
     *  Accepts full option objects or a plain list of mode strings (mapped to defaults). */
    modes?: EnvironmentModeOption[] | EnvironmentMode[];
}

// ============================================================================
// Component
// ============================================================================

/**
 * Environment mode switcher for URL transformation.
 *
 * [💻 Local][🐳 Docker] as a ChoiceToggle; the tooltip names the host each
 * mode puts in the URL.
 */
export const EnvironmentModeSwitcher: React.FC<EnvironmentModeSwitcherProps> = ({
    value,
    onChange,
    modes,
}) => {
    const resolvedModes: EnvironmentModeOption[] = (() => {
        if (!modes || modes.length === 0) return DEFAULT_MODES;
        return typeof modes[0] === 'string'
            ? DEFAULT_MODES.filter((m) => (modes as EnvironmentMode[]).includes(m.value))
            : (modes as EnvironmentModeOption[]);
    })();
    return (
        <ChoiceToggle
            value={value}
            onChange={onChange}
            options={resolvedModes.map((mode) => ({ value: mode.value, label: mode.label, tooltip: mode.tooltip, icon: mode.icon }))}
        />
    );
};

export default EnvironmentModeSwitcher;
