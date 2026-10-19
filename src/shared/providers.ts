export const PROVIDER_IDS = ['antigravity', 'claude', 'cursor', 'grok', 'minimax', 'zai', 'kimi', 'deepseek', 'moonshot', 'xai', 'anthropic'] as const;
export type ProviderId = typeof PROVIDER_IDS[number];
export type ProviderRegion = 'global' | 'china';
export type ProviderCategory = 'subscription' | 'api';

export interface ProviderSettings {
  id: ProviderId;
  enabled: boolean;
  region: ProviderRegion;
  team_id: string;
}

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  category: ProviderCategory;
  auth: 'local' | 'token' | 'cookie' | 'management' | 'admin';
  regions?: boolean;
  localImport?: boolean;
  help: { en: string; de: string };
  dashboard: string;
  chinaDashboard?: string;
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  { id: 'antigravity', name: 'Antigravity', category: 'subscription', auth: 'local', dashboard: 'https://antigravity.google/', help: {
    en: 'Reads the running Antigravity app/IDE locally. Alternatively install agy, sign in, and make its /usage command available on PATH. Only reported quota windows are shown.',
    de: 'Liest die laufende Antigravity-App/IDE lokal aus. Alternativ agy installieren, anmelden und den /usage-Befehl über PATH verfügbar machen. Es erscheinen nur gemeldete Limits.',
  } },
  { id: 'claude', name: 'Claude', category: 'subscription', auth: 'token', localImport: true, dashboard: 'https://claude.ai/settings/usage', help: {
    en: 'Import the current Claude Code OAuth login or enter an OAuth access token. An Anthropic API key does not read subscription limits. Renew expired logins in Claude Code, then import again.',
    de: 'Aktuelle Claude-Code-OAuth-Anmeldung importieren oder OAuth-Access-Token eingeben. Ein Anthropic-API-Key liest keine Abo-Limits. Abgelaufene Anmeldung in Claude Code erneuern und erneut importieren.',
  } },
  { id: 'cursor', name: 'Cursor', category: 'subscription', auth: 'cookie', dashboard: 'https://cursor.com/dashboard', help: {
    en: 'Enter the WorkosCursorSessionToken cookie from cursor.com (value or Cookie header). Included plan allowance and paid on-demand usage remain separate.',
    de: 'WorkosCursorSessionToken-Cookie von cursor.com eingeben (Wert oder Cookie-Header). Enthaltenes Abo-Kontingent und kostenpflichtige Zusatznutzung bleiben getrennt.',
  } },
  { id: 'grok', name: 'Grok / SuperGrok', category: 'subscription', auth: 'token', localImport: true, dashboard: 'https://grok.com/dashboard/billing', help: {
    en: 'Run grok login, then import its current OAuth login, or enter a SuperGrok OAuth bearer token. xAI inference/management API keys belong to the separate xAI API entry.',
    de: 'grok login ausführen und aktuelle OAuth-Anmeldung importieren oder SuperGrok-OAuth-Bearer-Token eingeben. xAI-Inferenz-/Management-Keys gehören zum getrennten xAI-API-Eintrag.',
  } },
  { id: 'minimax', name: 'MiniMax Coding / Token Plan', category: 'subscription', auth: 'token', regions: true, dashboard: 'https://platform.minimax.io/user-center/payment/coding-plan', chinaDashboard: 'https://platform.minimaxi.com/user-center/payment/coding-plan', help: {
    en: 'Use a Coding/Token Plan API key for the selected region, not a standard pay-as-you-go key. Missing or unknown plan windows stay unavailable.',
    de: 'Coding-/Token-Plan-API-Key für die gewählte Region verwenden, keinen normalen Pay-as-you-go-Key. Fehlende oder unbekannte Plan-Limits bleiben unbekannt.',
  } },
  { id: 'zai', name: 'z.ai / GLM Coding Plan', category: 'subscription', auth: 'token', regions: true, dashboard: 'https://z.ai/manage-apikey/coding-plan/personal/my-plan', chinaDashboard: 'https://bigmodel.cn/coding-plan/personal/usage', help: {
    en: 'Personal Coding Plan API key from z.ai (Global) or BigModel (China). Shared team quotas are not queried.',
    de: 'Persönlicher Coding-Plan-API-Key von z.ai (Global) oder BigModel (China). Gemeinsame Team-Kontingente werden nicht abgefragt.',
  } },
  { id: 'kimi', name: 'Kimi Code', category: 'subscription', auth: 'token', regions: true, dashboard: 'https://www.kimi.ai/code/console', chinaDashboard: 'https://www.kimi.com/code/console', help: {
    en: 'Kimi Code API key from the selected region. Moonshot Open Platform keys and balances belong to the separate API entry.',
    de: 'Kimi-Code-API-Key der gewählten Region. Moonshot-Open-Platform-Keys und Guthaben gehören zum getrennten API-Eintrag.',
  } },
  { id: 'deepseek', name: 'DeepSeek API', category: 'api', auth: 'token', dashboard: 'https://platform.deepseek.com/', help: {
    en: 'DeepSeek API key. Reports account balance in the supplied currencies; no artificial weekly quota or cost estimate.',
    de: 'DeepSeek-API-Key. Zeigt Kontoguthaben in den gelieferten Währungen; kein künstliches Wochenlimit oder geschätzte Kosten.',
  } },
  { id: 'moonshot', name: 'Moonshot / Kimi API', category: 'api', auth: 'token', regions: true, dashboard: 'https://platform.moonshot.ai/', chinaDashboard: 'https://platform.moonshot.cn/', help: {
    en: 'Moonshot Open Platform API key for the selected region. Shows account balance, separately from Kimi Code.',
    de: 'Moonshot-Open-Platform-API-Key für die gewählte Region. Zeigt Kontoguthaben getrennt von Kimi Code.',
  } },
  { id: 'xai', name: 'xAI / Grok API', category: 'api', auth: 'management', dashboard: 'https://console.x.ai/', help: {
    en: 'Management API key with billing read permission and team ID from console.x.ai. An inference key is insufficient. Posted prepaid balance may exclude not-yet-posted spend.',
    de: 'Management-API-Key mit Billing-Leserecht und Team-ID aus console.x.ai. Ein Inferenz-Key genügt nicht. Gebuchtes Guthaben kann noch nicht verbuchten Verbrauch ausschließen.',
  } },
  { id: 'anthropic', name: 'Anthropic / Claude API', category: 'api', auth: 'admin', dashboard: 'https://platform.claude.com/usage', help: {
    en: 'Organization Admin API key (sk-ant-admin…) with cost-report access. Shows reported spend over the last 30 days; separate from Claude subscription limits.',
    de: 'Organisations-Admin-API-Key (sk-ant-admin…) mit Zugriff auf Kostenberichte. Zeigt gemeldete Ausgaben der letzten 30 Tage, getrennt von Claude-Abo-Limits.',
  } },
];

export function defaultProviderSettings(id: ProviderId): ProviderSettings {
  return { id, enabled: false, region: id === 'kimi' ? 'china' : 'global', team_id: '' };
}

export interface ProviderWindow {
  id: string;
  label: string;
  used_percent: number;
  reset_at: number | null;
  window_seconds: number | null;
}

export interface ProviderAmount {
  kind: 'balance' | 'posted_balance' | 'spend' | 'included_spend' | 'on_demand_spend' | 'points';
  value: number;
  currency: string;
  period: 'current_cycle' | 'last_30_days' | null;
  partial?: boolean;
}

export type ProviderError = 'needs_auth' | 'expired' | 'local_unavailable' | 'network' | 'rate_limited' | 'unsupported_response' | 'keyring';
export type ProviderWarning = 'balance_unavailable' | 'monthly_exhausted';
export interface ProviderSnapshot {
  id: ProviderId;
  region: ProviderRegion;
  state: 'loading' | 'ready' | 'error';
  fetched_at: string | null;
  error: ProviderError | null;
  source: 'local' | 'api';
  plan: string | null;
  windows: ProviderWindow[];
  amounts: ProviderAmount[];
  warnings?: ProviderWarning[];
}

export interface ProviderConnection {
  id: ProviderId;
  region: ProviderRegion;
  configured: boolean;
}
