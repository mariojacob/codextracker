# Security Policy

## Supported versions

Security fixes are provided for the latest `2.x` release. Older versions may not receive security updates.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for a suspected vulnerability. Include a concise description, affected version, reproduction steps, and impact, but redact every credential and personal value.

Never attach or paste:

- `%USERPROFILE%\.codex\auth.json`;
- `%USERPROFILE%\.codex-tracker\config.json` or `history.jsonl`;
- files from `%USERPROFILE%\.codex-tracker\provider-history` (private usage and billing history);
- access tokens, refresh tokens, authorization headers, cookies, or credential exports; or
- raw API responses, builder debug files, crash dumps, or logs that may contain account data.

If you accidentally disclose an OAuth token, sign out of Codex CLI and sign in again so the credential can be replaced. Remove the disclosure from every public location, but assume the token was compromised even after deletion.

## Removing local data

1. Quit CodexTracker completely, including its tray process.
2. Delete `%USERPROFILE%\.codex-tracker` to remove authentication metadata, settings, and history.
3. Open **Credential Manager > Windows Credentials** and remove the entry with service `CodexTracker` and account `codex-oauth-refresh-token` if it remains.
4. If additional providers were configured, remove their `CodexTracker` entries whose accounts start with `provider-`. Each region has a separate entry.

CodexTracker's normal sign-out removes the Credential Manager entry and authentication metadata, but intentionally preserves settings and history.
