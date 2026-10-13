import { SupabaseClient } from '@supabase/supabase-js';
import type { GatewayConfig } from '@/types/gateway';

export const DEFAULT_GATEWAY_URL =
  process.env.EVOLUTION_API_URL || process.env.GATEWAY_URL || 'http://127.0.0.1:8080';
export const DEFAULT_GATEWAY_API_KEY =
  process.env.EVOLUTION_API_KEY || process.env.GATEWAY_API_KEY || 'fortline-secret-api-key';

export async function getGatewayConfig(
  supabase: SupabaseClient,
  accountId?: string | null
): Promise<GatewayConfig> {
  const envUrl = (
    process.env.EVOLUTION_API_URL ||
    process.env.GATEWAY_URL ||
    ''
  ).trim().replace(/\/+$/, '');

  const envKey = (
    process.env.EVOLUTION_API_KEY ||
    process.env.GATEWAY_API_KEY ||
    ''
  ).trim();

  if (accountId) {
    try {
      const { data, error } = await supabase
        .from('fortline_gateway_config')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle();

      if (!error && data && data.gateway_url) {
        const dbUrl = typeof data.gateway_url === 'string' ? data.gateway_url.trim().replace(/\/+$/, '') : '';
        const resolvedUrl = (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1'))
          ? envUrl
          : (dbUrl || envUrl || DEFAULT_GATEWAY_URL.replace(/\/+$/, ''));

        const dbKey = typeof data.api_key === 'string' ? data.api_key.trim() : '';
        const resolvedKey = (envKey && envKey !== 'fortline-secret-api-key')
          ? envKey
          : (dbKey || envKey || DEFAULT_GATEWAY_API_KEY);

        return {
          id: data.id,
          account_id: data.account_id,
          gateway_url: resolvedUrl,
          api_key: resolvedKey,
          webhook_secret: data.webhook_secret || '',
          is_enabled: data.is_enabled ?? true,
        };
      }
    } catch {
      // Fall through to env default
    }
  }

  return {
    gateway_url: (envUrl || DEFAULT_GATEWAY_URL).replace(/\/+$/, ''),
    api_key: envKey || DEFAULT_GATEWAY_API_KEY,
    is_enabled: true,
  };
}

export async function gatewayFetch(
  primaryUrl: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const cleanPrimary = (primaryUrl || DEFAULT_GATEWAY_URL).replace(/\/$/, '');
  const urlsToTry = [cleanPrimary];

  if (!cleanPrimary.includes('127.0.0.1') && !cleanPrimary.includes('localhost')) {
    urlsToTry.push('http://127.0.0.1:8080');
    urlsToTry.push('http://localhost:8080');
  }

  let lastError: any = null;
  for (const baseUrl of urlsToTry) {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        ...options,
        signal: AbortSignal.timeout(8000),
      });
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`Failed to reach gateway at ${urlsToTry.join(', ')}`);
}
