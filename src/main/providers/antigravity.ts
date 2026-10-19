import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';
import { ProviderFetchError } from './errors.js';
import { parseAntigravity, type ProviderData } from './parsers.js';

export interface LocalEndpoint { port: number; csrf: string; tls: boolean }

/** Fixed commands only; stdout may contain credentials and is never logged. */
function run(file: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new ProviderFetchError('local_unavailable')); return; }
    const child = spawn(file, args, { windowsHide: true, windowsVerbatimArguments: process.platform === 'win32' && path.basename(file).toLowerCase() === 'cmd.exe', stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0, settled = false;
    const finish = (error?: ProviderFetchError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) {
        if (process.platform === 'win32' && child.pid) {
          execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
        } else child.kill('SIGKILL');
        reject(error);
      } else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(() => finish(new ProviderFetchError('local_unavailable')), timeoutMs);
    const abort = () => finish(new ProviderFetchError('local_unavailable'));
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1048576) finish(new ProviderFetchError('unsupported_response'));
      else chunks.push(chunk);
    });
    child.on('error', () => finish(new ProviderFetchError('local_unavailable')));
    child.on('close', (code) => finish(code === 0 ? undefined : new ProviderFetchError('local_unavailable')));
  });
}

export function validateLocalEndpoints(value: unknown): LocalEndpoint[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is LocalEndpoint => entry && Number.isInteger(entry.port) && entry.port > 0 && entry.port <= 65535 &&
    typeof entry.tls === 'boolean' && typeof entry.csrf === 'string' && entry.csrf.length <= 4096 && !/[\x00-\x1f\x7f]/.test(entry.csrf)).slice(0, 6);
}

async function discover(signal?: AbortSignal): Promise<LocalEndpoint[]> {
  if (process.platform !== 'win32') return [];
  // Restrict credential discovery to Antigravity processes owned by the current Windows identity.
  const script = `
$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$found = @()
$processes = Get-CimInstance Win32_Process -Filter "Name LIKE 'language_server%' OR Name = 'agy.exe'"
foreach ($candidate in $processes) {
  if ($candidate.CommandLine -notmatch '(?i)antigravity|agy') { continue }
  try {
    $owner = Invoke-CimMethod -InputObject $candidate -MethodName GetOwner
    if (($owner.Domain + '\\' + $owner.User) -ne $identity) { continue }
    $csrf = ''
    if ($candidate.CommandLine -match '--csrf_token(?:=|\\s+)"?([^"\\s]+)') { $csrf = $Matches[1] }
    $ports = Get-NetTCPConnection -OwningProcess $candidate.ProcessId -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort -Unique
    foreach ($port in $ports) { $found += @{ port = [int]$port; csrf = $csrf; tls = $true } }
    if ($candidate.CommandLine -match '--extension_server_port(?:=|\\s+)(\\d+)') {
      $port = [int]$Matches[1]
      if ($candidate.CommandLine -match '--extension_server_csrf_token(?:=|\\s+)"?([^"\\s]+)') { $csrf = $Matches[1] }
      $found += @{ port = $port; csrf = $csrf; tls = $false }
    }
  } catch { continue }
}
ConvertTo-Json -InputObject @($found) -Compress
`;
  try {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], 12000, signal);
    return validateLocalEndpoints(JSON.parse(output.replace(/^\uFEFF/, '')));
  } catch { return []; }
}

/** TLS exceptions are confined to discovered loopback servers; external requests never use this path. */
function localRequest(endpoint: LocalEndpoint, method: string, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = endpoint.tls ? https : http;
    const request = client.request({
      hostname: '127.0.0.1', port: endpoint.port, signal,
      path: `/exa.language_server_pb.LanguageServerService/${method}`, method: 'POST',
      ...(endpoint.tls ? { rejectUnauthorized: false } : {}),
      headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1', 'X-Codeium-Csrf-Token': endpoint.csrf },
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new ProviderFetchError('local_unavailable')); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1048576) request.destroy(); else chunks.push(chunk);
      });
      response.on('error', () => reject(new ProviderFetchError('local_unavailable')));
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new ProviderFetchError('unsupported_response')); }
      });
    });
    const deadline = setTimeout(() => request.destroy(), 2000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', () => reject(new ProviderFetchError('local_unavailable')));
    request.end('{}');
  });
}

async function cliPath(): Promise<string | null> {
  const names = process.platform === 'win32' ? ['agy.exe', 'agy.cmd'] : ['agy'];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).slice(0, 100)) {
    if (!directory) continue;
    for (const name of names) {
      const candidate = path.resolve(directory.replace(/^"|"$/g, ''), name);
      try { await access(candidate); return candidate; } catch { /* Next PATH entry. */ }
    }
  }
  return null;
}

export async function fetchAntigravity(signal?: AbortSignal): Promise<ProviderData> {
  const candidates = await discover(signal);
  if (signal?.aborted) throw new ProviderFetchError('local_unavailable');
  const results = await Promise.allSettled(candidates.map(async (endpoint) => {
    for (const method of ['RetrieveUserQuotaSummary', 'GetUserStatus']) {
      if (signal?.aborted) throw new ProviderFetchError('local_unavailable');
      try { return parseAntigravity(await localRequest(endpoint, method, signal)); } catch { /* Try the legacy method. */ }
    }
    throw new ProviderFetchError('local_unavailable');
  }));
  const successful = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  if (successful.length) return successful.sort((a, b) => Number(b.windows.some((w) => w.window_seconds === 604800)) - Number(a.windows.some((w) => w.window_seconds === 604800)))[0];
  if (signal?.aborted) throw new ProviderFetchError('local_unavailable');

  const executable = await cliPath();
  if (!executable) throw new ProviderFetchError('local_unavailable');
  const invoke = (version: boolean) => {
    const args = version ? ['--version'] : ['-p', '/usage', '--output-format', 'json'];
    if (!executable.endsWith('.cmd')) return run(executable, args, version ? 5000 : 60000, signal);
    // cmd expands % and metacharacters even inside some quoting forms. Reject such PATH entries.
    if (/["&|<>^%!\r\n]/.test(executable)) throw new ProviderFetchError('local_unavailable');
    return run('cmd.exe', ['/d', '/s', '/c', `""${executable}" ${version ? '--version' : '-p /usage --output-format json'}"`], version ? 5000 : 60000, signal);
  };
  const version = (await invoke(true)).match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!version || Number(version[1]) < 1 || (Number(version[1]) === 1 && (Number(version[2]) < 1 || (Number(version[2]) === 1 && Number(version[3]) < 11)))) {
    throw new ProviderFetchError('local_unavailable');
  }
  const output = await invoke(false);
  try { return parseAntigravity(JSON.parse(output.replace(/^\uFEFF/, ''))); }
  catch { throw new ProviderFetchError('unsupported_response'); }
}
