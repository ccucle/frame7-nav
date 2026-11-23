# FORMDAY Connect — OAuth 2.1 + Google Firebase read-only MCP backend

**Status (2026-11-23): Development source only. NOT deployed, NOT installed into ChatGPT, NOT connected to any real health records.**

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
| `src/oauth-firestore-store.mjs` | Firestore transactional OAuth state storage in separate `formday_connect_oauth` collection (Admin SDK, server-side only) |
| `src/oauth-http.mjs` | OAuth discovery endpoints and consent/token routes |
| `src/oauth-consent-browser.mjs` | Explicit Google popup and read-only permission consent (no password or new Firebase account) |
| `src/mcp-gateway.mjs`, `src/server-runtime.mjs` | Bind OAuth token to Firebase UID; allow only approved read tools |
| `src/server-entry.mjs` | Node HTTP server and startup guard requiring real credentials and HTTPS origin |

## Security properties
- **No model input can select another user's UID or arbitrary Firestore path.**
- The MFA/OAuth browser authorization uses the **existing Firebase Google account**, not a new password.
- ChatGPT access tokens are opaque to the client, bound to the `https://<origin>/mcp` resource and the `formday:read` scope.
- Google/Firebase credentials never belong in a URL, GitHub, a chat, an MCP tool response or server logs.
- PKCE S256 and consent CSRF checks are required. Authorization codes and refresh tokens are consumed atomically in a Firestore transaction.
- The privileged Firebase Admin SDK is used solely to hold OAuth code/grant metadata, not to read the user's health data.
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
2. Actual Node SDK runtime test and OAuth integration test remain unexecuted here (network installation of npm dependencies unavailable). Source parse checks and memory-mock tests are not sufficient for production.
3. Test and implement OAuth grant revocation, Firebase refresh token rotation consistency, transactional bundle issuance on partial failures, and rate limiting.
4. Independent security review of privileged Firestore Admin credential, server-side CSP, CSRF and OAuth grant persistence.
5. Actual Render server deployment would consume free instance hours and can cause charges if account has payment method and bandwidth/build quota is exceeded. No web service has been created.
6. Deployment requires a Google Firebase service account and encryption key configured **directly in a trusted Render dashboard**; never share either in ChatGPT.
7. Add the new Render OAuth hostname to Firebase Authentication > Authorized domains. Current user account must remain unchanged.
8. After production HTTPS testing, register custom MCP plugin in ChatGPT web if account has appropriate access and verify on iPhone before considering the feature complete.

## Test commands (when dependencies are available)

```bash
cd formday-connect
npm install --ignore-scripts
npm test
```

Tests use synthetic Firebase IDs and do not access any real database.

## References
- https://developers.openai.com/plugins/build/auth
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- https://firebase.google.com/docs/reference/rest/auth
- https://firebase.google.com/docs/firestore/quotas
- https://render.com/docs/free
