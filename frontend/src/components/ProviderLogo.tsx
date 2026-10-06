import type { SxProps, Theme } from '@mui/material';
import ProviderIcon from '@/components/ProviderIcon';
import { useProviderIconId, type IconSource } from '@/utils/providerIcon';

/**
 * The vendor mark for a configured provider, shown beside its name in lists.
 * It says who the provider is; ApiStyleBadge beside it says which protocol it
 * speaks — two separate questions. Unrecognised providers get ProviderIcon's
 * neutral placeholder so names stay aligned down a column.
 */
export default function ProviderLogo({ provider, quotaType, size = 18, sx }: {
    provider: IconSource | undefined;
    /** The quota fetcher's provider_type, when the row has a reading. */
    quotaType?: string;
    size?: number;
    sx?: SxProps<Theme>;
}) {
    const iconId = useProviderIconId();
    return <ProviderIcon identifier={iconId(provider, quotaType) ?? ''} size={size} sx={sx} />;
}
