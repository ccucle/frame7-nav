# FORMDAY Connect · Read-only MCP / Google authentication integration

**Development status (2026-11-23):** source implemented and syntax-checked; **NOT deployed, NOT connected to ChatGPT, no actual Firestore personal records read or modified**.

## User goal

- Run coaching **in ChatGPT**, not inside FORMDAY.
- ChatGPT plugin should read FORMDAY cloud records on both PC and iPhone and ultimately write approved future plans.
- Preserve the original Google Firebase account, existing records, and v0.6.0 website.
- Extra operating charges must not be introduced without an explicit decision.

## Completed source (branch only)

- `src/reader.mjs`: bounded, sanitized calendar / IRON MODE snapshot views.
- `src/tools.mjs`: 6 read-only tools with strict input schema. No model-controlled Firebase UID or path.
- `src/firebase-rest.mjs`: **preferred** server-side Firebase ID token signature verifier and Security-Rules-aware Firestore REST reader. Verifies RS256 signatures using Google's published signing certificates and validates audience, issuer, UID, expiry and timestamps.
- `src/mcp-gateway.mjs`: MCP server registration and HTTP gateway using official Model Context Protocol SDK v2. **Fails closed until a trusted ChatGPT OAuth verifier is installed.** Compares verified OAuth UID with verified Firebase token UID before reading data.
- `src/firebase-adapter.mjs`: earlier Firebase Admin alternative; **not recommended for this flow**, as Admin bypasses Firestore Security Rules and requires a privileged service account. Not used by the new MCP gateway.
- `test/reader.test.mjs`, `test/firebase-rest.test.mjs`, `test/mcp-gateway.test.mjs`: isolated synthetic-data tests for read results, token signature / expiry / project binding, strict owner document paths, and unauthorized gateway behavior.

## Tools

| Tool | Purpose |
| --- | --- |
| `formday_status` | Check presence and revision of calendar and IRON documents |
| `formday_workouts` | Read actual completed or partially completed strength workouts |
| `formday_routines` | Read planned routine targets |
| `formday_calendar` | Read calendar events (without inventing recurrence expansions) |
| `formday_meals` | Read recorded food names; no unverified calorie estimates |
| `formday_weight_history` | Read completed weight measurements |

Each read uses the user's existing `users/{firebaseUid}/formday_sync/{calendar|iron}` Firestore documents. Firestore REST uses a Firebase **user** ID token so security rules are enforced. No privileged Admin service-account credentials are required for this preferred route.

## Next required blocker: ChatGPT OAuth 2.1

ChatGPT cannot simply reuse the Firebase login session from the standalone FORMDAY web app.

Before deploying or installing a plugin, build/configure a real OAuth 2.1 authorization server:

1. Expose standards-compliant protected-resource and OAuth authorization-server metadata over HTTPS.
2. Support ChatGPT CIMD (preferred) or DCR, the exact registered redirect URI, PKCE S256, resource/audience binding, scopes and access/refresh token verification.
3. Authenticate the user with the original Firebase Google account via a user-consent screen. Bind each OAuth grant to the **verified Firebase UID**; do not derive identity from an email string or untrusted tool argument.
4. Handle refresh tokens and secure revocation/rotation with durable storage, cookie/CSRF protections, rate limits and audit logs that **exclude credential and health information**.
5. Resolve a **fresh Firebase ID token** for each MCP session and verify it again server-side. Never hand this Firebase token to the model or place it in a tool argument.
6. Add an authorization test to prove another account cannot access the owner's data.
7. Deploy a separate secured Render (or other) backend only after OAuth/security review. Existing FORMDAY static service is unrelated and must remain unchanged.
8. Install/test the resulting private plugin via ChatGPT on the web, then verify tool usage in the **iPhone ChatGPT app**. Do not declare PC+mobile success before the actual phone test.

**Do not expose an unauthenticated/private-data MCP endpoint, export API secrets, or package a placeholder plugin.**

## Cost and platform limits

Render supports Free web services, but Free instances sleep after 15 idle minutes and monthly usage is shared across services. **Bandwidth and build overages can be billed if a payment method is present.** Since the user requires no added charges, creating a new web service requires confirming acceptable usage/limits before provisioning.

OpenAI Help Center currently says direct custom MCP **connection setup is on ChatGPT web only**. ChatGPT mobile tool invocation of this private server remains **unverified** and is a release blocker.

## Tests

Node 22+ after installing project dependencies:

```bash
cd formday-connect
npm install
npm test
```

These are synthetic, isolated tests. Source static syntax and adapter/dispatcher mock behavior have been checked; **the full SDK runtime test has not been run in this chat** because the SDK dependencies are not installed in the working runtime.

## Official references

- https://developers.openai.com/plugins/build/auth
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- https://firebase.google.com/docs/auth/admin/verify-id-tokens
- https://firebase.google.com/docs/firestore/use-rest-api
- https://render.com/docs/free
