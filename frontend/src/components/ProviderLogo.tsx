import type { SxProps, Theme } from '@mui/material';
import ProviderIcon from '@/components/ProviderIcon';
import { useProviderIconId, type IconSource } from '@/utils/providerIcon';
import { useProvidersByUuid } from '@/hooks/useProvidersByUuid';

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

/**
 * ProviderLogo for rows that only know a provider's uuid (dashboard tables):
 * the provider is looked up from the shared list, and until it loads — or for
 * a provider since deleted — the quota type alone decides, else the placeholder.
 */
export function ProviderLogoByUuid({ uuid, ...rest }: { uuid: string | undefined } & Omit<Parameters<typeof ProviderLogo>[0], 'provider'>) {
    const providers = useProvidersByUuid();
    return <ProviderLogo provider={uuid ? providers.get(uuid) : undefined} {...rest} />;
}
