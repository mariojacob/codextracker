# Usage providers and modules

Open **Settings → Providers & modules** (German: **Einstellungen → Anbieter & Module**) and enable the services you want to monitor. ChatGPT / Codex appears as its own card in the subscriptions group and has the same enable/disable switch as other services. Codex remains enabled by default for compatibility; every additional provider is off by default. Other providers can run without a Codex account.

Disabling Codex hides its card, stops polling and notifications, cancels pending quota requests, and removes its readings from the tray. The saved login and history remain available when you enable it again. The import, refresh and sign-out controls are inside its settings entry. A disabled state persists across restarts. If all modules are disabled, the main view links back to Settings.

Subscription quotas and API billing appear in separate groups. A dollar allowance included in a subscription is not treated as paid API spend. Balances in different currencies are never added together. Missing quota fields remain unavailable instead of becoming zero usage.

| Provider | Setup | Displayed data |
| --- | --- | --- |
| ChatGPT / Codex | Enable its module, sign in through the Codex CLI, then import the login. | Session and weekly quotas, reset credits, Codex credits and observed usage history. |
| Antigravity | Open the signed-in desktop app/IDE, or install and sign in to `agy` on PATH. The print-mode fallback requires agy 1.1.11+. | Reported grouped Gemini and Claude/GPT quotas, reset times, or legacy per-model quotas. Weekly windows appear only when supplied. |
| Claude | Explicitly import `%USERPROFILE%\.claude\.credentials.json`, or enter a Claude Code OAuth access token. | Session, weekly and supplied model-specific quotas; reported paid extra usage. Ordinary inference API keys cannot read subscription quota. |
| Cursor | Enter the `WorkosCursorSessionToken` cookie value or Cookie header from cursor.com. Only this cookie is sent to Cursor. | Included plan allowance and reported on-demand spend, kept separate; current billing cycle. |
| Grok / SuperGrok | Run `grok login`, then explicitly import `%USERPROFILE%\.grok\auth.json`, or paste its OAuth bearer token. | Reported subscription credit utilization and reset. Period-only responses remain unknown. Some account types may not expose this data. |
| MiniMax Coding / Token Plan | Enter a Coding/Token Plan key for Global or China. A standard pay-as-you-go key is a different product. | Reported interval and weekly quota per model/service; plan points when supplied. |
| z.ai / GLM | Personal Coding Plan API key for Global or BigModel China. | Reported Coding Plan and MCP quota windows. Team scopes are not configured in this version. |
| Kimi Code | Kimi Code API key for the selected region; China is the default. | Reported session, weekly and monthly pools, or legacy count-based quotas. |
| DeepSeek API | DeepSeek inference API key. | Account balance in each reported currency. |
| Moonshot / Kimi API | Open Platform API key for Global or China. | Available account balance in USD or CNY, separate from Kimi Code. |
| xAI / Grok API | **Management** API key with billing read permission, plus team ID. An inference key is insufficient. | Posted prepaid ledger balance. This may exclude spend not yet posted in the current cycle. |
| Anthropic / Claude API | Organization **Admin** API key with cost-report access. | Vendor-reported spend over the last 30 days. Incomplete pagination is labeled incomplete. |

## Credentials and refresh

- Additional credentials are stored in Windows Credential Manager under service `CodexTracker`, account `provider-<id>-<region>`. Settings contain only enablement, region and xAI team ID. Password fields never reload a stored secret into the renderer.
- Regions have separate credential entries. Switching regions never forwards the previous region's key to a different host. Removing a credential affects the selected region; switch to another region to remove its saved credential too.
- CLI credential imports happen only after clicking **Import CLI login**. Only the current access token and its expiration time are imported. CodexTracker never imports refresh tokens, renews another tool's login, or edits its credential file. Renew an expired login in the original CLI, then import it again.
- Antigravity discovery inspects only matching processes owned by the current Windows identity. It queries their loopback service using the discovered CSRF token. Self-signed TLS is accepted only for those loopback probes; external provider requests retain normal TLS validation.
- The agy fallback runs only the version and non-interactive `/usage` commands, with bounded output and timeouts. It never sends a chat prompt.
- Polling uses at least a 60-second interval and honors server rate-limit backoff. Disabling, changing region, or removing a login cancels pending work and discards late results. Network failures can retain a visibly stale reading; rejected authentication clears the old data.
- Fresh additional-provider readings are saved locally in `%USERPROFILE%\.codex-tracker\provider-history`, separated by provider and region. Statistics read the most recent 30 days; older entries are pruned when that provider next records data. Only allowlisted numeric readings, quota labels/identifiers, reset metadata, timestamps and random connection/segment identifiers are stored. API keys, cookies, account emails, plan names and raw responses are excluded. The xAI team scope is hashed.
- The statistics window selects one module and one independent quota/currency at a time. Enabled modules and paused modules with stored history are available. Weekly windows with a valid current reset use budget days; other quotas and balance trends use local calendar days, including 23/25-hour daylight-saving days. Missing reset metadata permits a last reading but no derived quota consumption.
- Disabling/re-enabling, restarting tracking and changing configuration break comparisons. Explicitly saving, importing or removing a provider credential starts a new saved-login context; earlier entries stay on disk until retention removes them but are excluded from the new context’s statistics. Region and xAI-team histories never mix. Antigravity does not expose a stable account identity, so switching accounts inside that app cannot always be detected.
- Only fresh successful readings are measurements. Failed requests create empty gap records; cached display fallbacks are never logged as fresh data. Quota changes require matching reset windows and timely adjacent readings. Reset jumps, decreasing usage, missing values and gaps longer than `max(5 minutes, twice the refresh interval)` are excluded. Short intervals spanning days are apportioned and labeled approximate.
- Balance/posted-balance/point decreases and increases are observed changes, not verified expenses. Vendor-reported rolling costs and billing-cycle usage are displayed as latest values and daily last-reading trends; samples are never summed or turned into daily costs. Currencies and independent quota pools stay separate. Open statistics update after persisted measurements.
- **Sign out of Codex** removes only the Codex login. Disable additional providers and remove their credentials separately.

## Network sources and compatibility

Requests are restricted to fixed provider-owned HTTPS hosts; redirects are rejected. Provider responses, tokens, cookies and raw HTTP error bodies are not logged or returned as diagnostics.

The integrations use:

- Local Antigravity `RetrieveUserQuotaSummary` / `GetUserStatus`, or `agy -p /usage --output-format json`.
- `api.anthropic.com/api/oauth/usage` for Claude subscription quota and `/v1/organizations/cost_report` for organization API spend.
- `cursor.com/api/usage-summary` for Cursor.
- `cli-chat-proxy.grok.com/v1/billing?format=credits` for Grok/SuperGrok.
- `api.minimax.io` or `api.minimaxi.com`, `/v1/token_plan/remains`, with the legacy `/v1/api/openplatform/coding_plan/remains` fallback.
- `api.z.ai` or `open.bigmodel.cn`, `/api/monitor/usage/quota/limit`.
- `api.kimi.ai` or `api.kimi.com`, `/coding/v1/usages`.
- `api.deepseek.com/user/balance`.
- `api.moonshot.ai` or `api.moonshot.cn`, `/v1/users/me/balance`.
- `management-api.x.ai/v1/billing/teams/<team-id>/prepaid/balance`.

Several subscription endpoints are private and can change. Unsupported account types, missing fields, expired sessions and provider-side changes are shown explicitly. Parser and service tests use representative fixtures; successful access with a particular account still requires its own valid credential.

Reference material: [Antigravity usage](https://antigravity.google/docs/cli/commands/usage), [DeepSeek balance](https://api-docs.deepseek.com/api/get-user-balance/), [xAI billing](https://docs.x.ai/developers/rest-api-reference/management/billing), [Anthropic cost report](https://platform.claude.com/docs/en/api/admin/cost_report/retrieve), and the provider response notes in [CodexBar](https://github.com/steipete/CodexBar/blob/main/docs/providers.md).
