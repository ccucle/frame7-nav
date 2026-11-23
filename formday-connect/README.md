# FORMDAY Connect — OAuth 2.1 + Google Firebase read-only MCP backend

**Status (2026-11-24): Phase 4 hardening and synthetic HTTP integration tested (47 passing). NOT deployed, NOT installed into ChatGPT, NOT connected to real health records. Production deployment is blocked.**

See [Phase 4 verification and release blockers](PHASE4-REVIEW.md) for evidence, platform support, and the exact distinction between local testing and real connection.

## Product requirements
- Use existing FORMDAY Firebase Google identity to coach from ChatGPT, not from an AI chat widget embedded in the website.
- PC and iPhone must BOTH work before the plugin may be considered ready.
- Initially read-only; never edit historical actual workouts, meal entries, bodyweight or backups.
- Preserve Firebase Spark free database and existing FORMDAY v0.6.0; no added charges without approval.

## Current source modules

| Source | Implementation |
| --- | --- |
| `src/reader.mjs`, `src/tools.mjs` | Six bounded read-only tools over the two current Firestore snapshots |
| `src/firebase-rest.mjs` | Verify Firebase RSA token; use USER bearer token to read original records under existing Firestore Security Rules |
| `src/oauth-core.mjs` | OAuth authorization-code + PKCE S256, CIMD metadata verification, read scope, resource binding, one-time codes and rotating refresh token design |
| `src/oauth-vault.mjs` | AES-256-GCM encryption of user Firebase refresh tokens using secret environment key |
| `src/firebase-refresh.mjs` | Firebase Secure Token REST exchange for fresh user ID token |
| `src/oauth-firestore-store.mjs` | OAuth state adapter; production must use a separate project, not the existing health-data project |
| `src/oauth-http.mjs` | OAuth discovery endpoints and consent/token routes |
| `src/oauth-consent-browser.mjs` | Explicit Google popup and read-only permission consent (no password or new Firebase account) |
| `src/mcp-gateway.mjs`, `src/server-runtime.mjs` | Bind OAuth token to Firebase UID; allow only approved read tools |
| `src/server-entry.mjs`, `src/deployment-config.mjs`, `src/node-http.mjs` | HTTP server and startup guard requiring a separate OAuth storage project, credentials and HTTPS origin |

## Security properties
- **No model input can select another user's UID or arbitrary Firestore path.**
- Browser authorization uses Firebase Google sign-in, with in-memory browser persistence and sign-out after consent. This code does not implement an MFA flow. Selecting an unknown Google account can create a new Firebase Auth user; first-login prevention remains a deployment blocker under the no-account-change requirement.
- ChatGPT access tokens are opaque to the client, bound to the `https://<origin>/mcp` resource and the `formday:read` scope.
- Google/Firebase credentials never belong in a URL, GitHub, a chat, an MCP tool response or server logs.
- PKCE S256 and consent CSRF checks are required. Authorization codes and refresh tokens are consumed atomically in a Firestore transaction.
- The production entry point rejects an Admin credential or OAuth storage project matching `healthy-df79f`. The existing project is accessed only through the user-token reader. A separate project has NOT been provisioned.
- **Admin SDK bypasses Firestore rules.** This is a significant privilege risk: credentials must remain private, server IAM must be reviewed and a compromised server may still access more than intended.
- User record reads use Firebase USER tokens and the current Firestore rules, not Admin.
- The token store requires a durable Firestore database; no ephemeral Render SQLite or memory storage in production.
- Firestore TTL automated deletions are NOT enabled because they require billing; expired token records require carefully designed manual cleanup.

## OAuth discovery requirements
- `/.well-known/oauth-protected-resource`: resource and authorization server metadata.
- `/.well-known/oauth-authorization-server`: issuer, PKCE S256, CIMD support, code and refresh grants.
- `/oauth/authorize`: validates official ChatGPT CIMD client metadata and redirects with secure session cookies to consent page.
- `/oauth/consent`: explicit Google sign-in and approval.
- `/oauth/token`: exchanges a one-time PKCE code or refresh token.
- `/mcp`: protected MCP transport, all calls read-only.

## Not yet proven / release blockers

1. **Critical:** OpenAI currently documents direct custom MCP connections as **web-only**. The requirement that iPhone ChatGPT must use the same plugin is NOT met; do not promise mobile support.
2. **Synthetic runtime tests PASS:** baseline CI passed 37 tests. Phase 4 passes 47 locally with real loopback HTTP, RSA signatures and MCP SDK execution; external providers and storage are doubles. This does **not** establish browser Google login, real Firestore rules, HTTPS hosting or mobile availability.
3. Test and implement OAuth grant revocation, Firebase refresh token rotation consistency, transactional bundle issuance on partial failures, and rate limiting.
4. Independent security review of privileged Firestore Admin credential, server-side CSP, CSRF and OAuth grant persistence.
5. Actual Render server deployment would consume free instance hours and can cause charges if account has payment method and bandwidth/build quota is exceeded. No web service has been created.
6. Deployment requires isolated OAuth storage, a service identity with no IAM access to the existing project, and an encryption key configured **directly in trusted secret storage**. Never share credentials in ChatGPT. Project-ID validation does not verify IAM permissions.
7. Add the new Render OAuth hostname to Firebase Authentication > Authorized domains. Current user account must remain unchanged.
8. Do not promise iPhone support from PC registration. A supported distribution route and actual iPhone verification must be established separately before product completion.

## Verified CI result

- [GitHub Actions run #6 — 37 passed, 0 failed](https://github.com/ccucle/frame7-nav/actions/runs/45202274989)
- Public repository on standard GitHub-hosted runners. No credentials, real user records or paid services were used.
- Tests include the actual MCP SDK processing an authenticated synthetic `initialize`, `tools/list`, and `tools/call` exchange.
- **Do not** infer Google login success, mobile ChatGPT plugin support or production security from this test suite.

## Test commands

```bash
cd formday-connect
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Tests use synthetic Firebase IDs and do not access any real database.

## References
- https://developers.openai.com/plugins/build/auth
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- https://firebase.google.com/docs/reference/rest/auth
- https://firebase.google.com/docs/firestore/quotas
- https://render.com/docs/free
