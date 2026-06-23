# Security Audit Findings

## Summary
11 findings: 0 CRITICAL, 2 HIGH, 5 MEDIUM, 3 LOW, 1 POSITIVE

## Findings

### [HIGH] API server has no authentication — any local process can read all member data
- File: `src/api/server.ts:104-193`
- What: The HTTP API exposes member data, reports, group lists, and chat history with zero authentication checks.
- Why: Any process on the same machine (or any container in the same network namespace) can hit `/members`, `/reports/*`, `/groups`, `/chats`, and `/tier` to exfiltrate member PII (names, viewer IDs, transfer history, club rank, fan counts). A misconfigured Docker `EXPOSE` or port forward extends this to the network.
- How: Add at minimum a bearer token check. Generate a random token at startup (or read from env), require `Authorization: Bearer <token>` on all endpoints except `/health`. Example:
  ```typescript
  // At the top of handleRequest, before routing:
  const authHeader = req.headers['authorization'];
  if (path !== '/health' && authHeader !== `Bearer ${this.apiToken}`) {
    createResponse(res, 401, { success: false, error: 'Unauthorized' });
    return;
  }
  ```
  Set `this.apiToken` from `process.env.API_TOKEN` (required, fail if missing).
- Confidence: HIGH

### [HIGH] Error messages leaked in API /groups response body
- File: `src/api/server.ts:227`
- What: The `/groups` endpoint returns `(error as Error).message` directly in the JSON response body.
- Why: Internal error messages can reveal file paths, library versions, or internal state. If the API is port-forwarded, this becomes an information disclosure vector. Combined with the missing auth finding, any network-adjacent attacker can probe for internal details.
- How: Replace with a generic error message. Log the full error server-side.
  ```typescript
  // Before:
  createResponse(res, 500, { success: false, error: (error as Error).message });
  // After:
  log.error('API', 'groups handler error', error);
  createResponse(res, 500, { success: false, error: 'Internal server error' });
  ```
- Confidence: HIGH

### [MEDIUM] Dockerfile bakes config.yaml (with admin JIDs) into image layer
- File: `Dockerfile:38`
- What: `COPY config.yaml ./` copies the live config file — containing admin WhatsApp JIDs, group JIDs, and circle ID — into a permanent Docker image layer.
- Why: Anyone with access to the built image (via `docker history`, a registry, or a saved tarball) can extract admin JIDs and group identifiers. These JIDs can be used for WhatsApp social engineering or spam targeting.
- How: Remove `COPY config.yaml ./` from the Dockerfile. Mount config.yaml at runtime instead: `docker run -v $(pwd)/config.yaml:/app/config.yaml ...`. If build-time inclusion is required, use a multi-stage build or `--secret` mount.
- Confidence: HIGH

### [MEDIUM] Rate limiter Map grows unbounded — potential memory exhaustion
- File: `src/api/server.ts:56,239-249`
- What: `requestTimestamps` is a `Map<string, number[]>` that is never pruned. Each unique client IP gets an entry that persists for the process lifetime.
- Why: While the API binds to `127.0.0.1` (limiting IPs to loopback), a misconfigured port forward or container networking could expose the API to many IPs. Each IP's timestamps array grows without bound during the 1-second window but older entries are filtered — however, the Map keys themselves never get removed. In extreme scenarios, this could consume memory.
- How: Add a periodic cleanup (e.g., every 60 seconds, delete entries with no recent timestamps). Or use a fixed-size LRU cache. For localhost-only, the practical risk is low, but it's a correctness issue.
  ```typescript
  // Example: prune every 60s
  private startPruning(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [ip, timestamps] of this.requestTimestamps) {
        const recent = timestamps.filter(t => now - t < 2000);
        if (recent.length === 0) this.requestTimestamps.delete(ip);
        else this.requestTimestamps.set(ip, recent);
      }
    }, 60_000);
  }
  ```
- Confidence: MEDIUM

### [MEDIUM] `console.error` monkey-patching suppresses potentially security-relevant errors
- File: `src/whatsapp/client.ts:52-68`
- What: The `suppressLibsignalErrors()` function globally replaces `console.error` to silently drop messages containing "Failed to decrypt message", "Session error", or "Bad MAC".
- Why: While these are known libsignal operational noise, the monkey-patch is global and persists for the process lifetime. If Baileys or libsignal update and introduce new security-relevant error patterns (e.g., key compromise, session hijacking), they would be suppressed. "Bad MAC" in particular can indicate a man-in-the-middle attack or session compromise — suppressing it entirely removes a detection signal.
- How: Consider routing these through the structured logger at `debug` level instead of dropping them entirely, so they're still recorded in the log file for forensic analysis:
  ```typescript
  if (joined.includes('Failed to decrypt message') || ...) {
    log.debug('Libsignal', `Suppressed: ${joined.slice(0, 200)}`);
    return;
  }
  ```
- Confidence: MEDIUM

### [MEDIUM] WhatsApp session directory path from env var without sanitization
- File: `src/whatsapp/client.ts:138`
- What: `WA_SESSION_DIR` env var is used directly as a filesystem path: `private authDir = process.env.WA_SESSION_DIR ?? 'data/auth'`.
- Why: If `WA_SESSION_DIR` is set to a sensitive directory (e.g., `/etc`, `/root`), the bot would store WhatsApp session credentials (identity keys, pre-keys) there. This could overwrite system files or create world-readable credential files in unexpected locations.
- How: Validate the resolved path is within the project directory:
  ```typescript
  import { resolve, relative } from 'path';
  const resolved = resolve(this.authDir);
  if (!resolved.startsWith(resolve('.'))) {
    throw new Error(`WA_SESSION_DIR must be within project directory: ${resolved}`);
  }
  ```
  Alternatively, validate against a whitelist of allowed parent directories.
- Confidence: MEDIUM

### [LOW] No security headers beyond X-Content-Type-Options and X-Frame-Options on API
- File: `src/api/server.ts:33-34`
- What: The API sets `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` but lacks `Cache-Control: no-store`, `X-XSS-Protection`, and `Strict-Transport-Security`.
- Why: While the API is localhost-only and serves only JSON (no HTML), missing `Cache-Control` headers could cause browser-cached sensitive data to persist. If the API is ever exposed beyond localhost, these headers become more important.
- How: Add `Cache-Control: no-store, no-cache` to responses. Low priority given localhost binding.
- Confidence: LOW

### [LOW] `saveConfig` atomic write uses non-exclusive temp file creation
- File: `src/config.ts:226-228`
- What: The atomic write pattern creates a `.tmp` file and renames it, but does not use exclusive creation flags. The temp file path is predictable (`config.yaml.tmp`).
- Why: If another process or user creates `config.yaml.tmp` as a symlink, the bot would write config data to an arbitrary location. This requires local privilege escalation (write access to the project directory), so it's low practical risk.
- How: Use a random temp filename or use `writeFileSync` with `{ flag: 'wx' }` (exclusive create) to fail if the file already exists.
- Confidence: LOW

### [LOW] Log injection possible via user-controlled WhatsApp message content
- File: `src/whatsapp/dispatch.ts:134`, `src/whatsapp/client.ts:338`
- What: User-controlled message text is interpolated into log lines: `log.debug('Dispatch', 'No command prefix match for: "${text.slice(0, 80)}"')`.
- Why: A crafted WhatsApp message containing newlines or log-format characters could inject fake log entries, making log analysis unreliable or masking real events. The structured log format (`[timestamp] [LEVEL] [Tag] message`) provides some protection, but doesn't prevent injection within the message body.
- How: Sanitize user-controlled content in log messages by replacing newlines: `text.slice(0, 80).replace(/[\r\n]/g, ' ')`. Low priority — this is an integrity concern, not a confidentiality or availability risk.
- Confidence: LOW

### [POSITIVE] SQL injection fully mitigated — all queries parameterized
- File: `src/db/database.ts:165,186,209,227,246,251,272,293,319,329,351,369`
- What: Every SQL query in the database module uses `?` parameterized placeholders. No string interpolation of user-controlled values into SQL.
- Why: This eliminates SQL injection (CWE-89) entirely. All data flowing into SQL — report types, viewer IDs, alert keys, JIDs — passes through parameter arrays, never concatenated into query strings.
- How: No change needed. This is exemplary practice. Maintain this pattern for all future database operations.
- Confidence: HIGH

## Modules Reviewed

- `src/whatsapp/dispatch.ts`: 1 finding (log injection)
- `src/whatsapp/commands.ts`: clean — strict integer parsing, no injection vectors
- `src/whatsapp/access.ts`: clean — proper access control logic
- `src/whatsapp/admin.ts`: clean — admin-only handlers, config writes gated by access control
- `src/whatsapp/client.ts`: 2 findings (console.error suppression, env var path)
- `src/api/server.ts`: 3 findings (no auth, error leak, rate limiter memory)
- `src/api/uma-moe.ts`: clean — SSRF not possible (numeric params only, constant base URL)
- `src/config.ts`: 1 finding (temp file creation)
- `src/data/snapshot.ts`: clean — path validation regex, parameterized DB calls
- `src/db/database.ts`: POSITIVE — all parameterized queries
- `src/orchestrator/report-orchestrator.ts`: clean
- `src/scheduler/scheduler.ts`: clean — cron expressions derived from Zod-validated config
- `src/utils/logger.ts`: clean
- `src/utils/format.ts`: clean
- `src/index.ts`: clean — port validation, env vars properly handled
- `Dockerfile`: 1 finding (config.yaml in image layer)

## Low-Confidence Notes

- [src/api/server.ts:108] The `url.pathname` routing uses simple string equality (`path === '/health'`). If `req.url` contains encoded characters (e.g., `%2f`), the URL constructor may normalize them differently than expected. Need to verify Node.js `URL` behavior with encoded slashes — could potentially bypass routing to snapshot-dependent endpoints.
- [src/data/snapshot.ts:333-338] `listDirs()` reads directory entries without filtering for symlink attacks. If an attacker could create a symlink in `data/snapshots/`, the bot could follow it to read files outside the intended directory. Low practical risk since snapshots are write-once and the bot is the only writer.
- [src/index.ts:90] Uses `require('path').resolve()` inline instead of a top-level import. Not a security issue, but unusual. The `require` is evaluated at runtime which is fine for a composition root.
