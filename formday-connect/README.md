# FORMDAY Connect — scoped MCP/OAuth backend

**2026-11-24: Phase 5 source v0.4.0. 67 synthetic tests pass locally. Not deployed, not installed in ChatGPT, not connected to real records.**

[Phase 5 implementation and limitations](PHASE5-APPEND.md) · [Phase 4 security review](PHASE4-REVIEW.md)

## User-facing behavior

- Six read tools for cloud status, actual workouts, routines/programs, calendar, meals and weight history.
- Optional previews for adding an existing routine to a dated calendar, creating a program from existing routines, and adding a consumed meal.
- One commit tool saves exactly the previewed addition. No tools edit/delete existing items or manufacture completed workout sessions.
- Meal photos are interpreted in ChatGPT. The backend accepts structured foods and portions, labels estimates, and preserves unknown nutrients as null. No image upload or separate image-model API is implemented.
- PC and iPhone must both be verified before release. Local code installation does not establish mobile availability.

## Scope and data protection

Default is read-only. The exact server setting FORMDAY_ENABLE_APPEND=true AND a new OAuth consent granting formday:read formday:append are required to expose the four append tools. Existing read grants remain read-only. The consent page reads the stored flow and displays the requested permissions.

The signed preview binds user, MCP resource, exact entry, payload hash, snapshot revision and Firestore updateTime. New writes expire after ten minutes. Reusing the same preview can check whether that exact entry already exists, even after expiry, without another write. A fresh preview is a distinct operation; it is not a global duplicate detector.

Writes use Firebase USER ID tokens, not Admin credentials. Only the authenticated user's calendar or iron snapshot can be changed. Each write uses an updateTime precondition and a server timestamp. A missing document, conflict, unsupported schema, demo calendar, oversized payload or permission denial fails closed. Existing JSON entries and unrelated snapshot properties are preserved; only the appended collection and revision change.

The source validators in ../fitplan/core.js, nutrition.js, data.js and iron-store.js are reused without editing them. Deploy from the full repository, retaining that relative layout. Copying formday-connect alone is insufficient.

## Running tests

From the repository root:

~~~sh
cd formday-connect
npm ci --ignore-scripts --no-audit --no-fund
npm test
~~~

Tests use synthetic identities, provider/storage doubles, real RSA signatures, the actual MCP SDK and local loopback HTTP. They do not access a real database, Google account or ChatGPT client. CI runs Node 22 and 24.

## Runtime configuration

See .env.example. The entry point requires an HTTPS origin, an OAuth encryption key, Firebase public web API key, and a dedicated durable OAuth store in a separate Firebase project. It rejects Admin storage credentials identifying the existing healthy-df79f project. Project validation alone does not prove IAM isolation. Never put private keys or user tokens in GitHub, chat, tool arguments, URLs or logs. Preview tokens contain personal entry data encoded in base64 and a signature; they are not encrypted and must not be logged or shared.

## Release blockers

1. No Connect web service, isolated OAuth storage, verified IAM isolation or production secrets have been provisioned. No paid service was created. Existing FORMDAY v0.6.0, Firebase data/rules and authentication settings remain unchanged.
2. OAuth token-bundle issuance is not atomic; grant-family revocation, concurrent Firebase credential rotation, request limits and expired-secret cleanup still require implementation and failure testing. This remains development code, with writes disabled by default.
3. Actual Google browser login, authorized domains, exact ChatGPT callback/CIMD registration, live Firestore rules and owner-account read/write smoke tests remain unverified. Selecting a new Google account can create a Firebase Auth user; first-login prevention remains unresolved.
4. The website requires cloud download to apply remote records. Local unsynced changes may conflict; active IRON sessions can block download. No automatic site refresh was added.
5. The prior official-document review found direct custom MCP connections web-only. A supported iPhone distribution path and real PC/iPhone testing remain necessary. See Phase 4 for sources and the distinction from general mobile plugins.

## Main modules

- reader.mjs / tools.mjs: bounded owner reads, Korea calendar defaults, meal amounts/source evidence, program summaries.
- append.mjs: strict preview schemas, signed capability, append-only transformations and conflict/retry behavior.
- firebase-rest.mjs / firebase-append.mjs: verified Firebase identity, two-document reads, conditional user-token REST commit.
- oauth-core.mjs / oauth-http.mjs: PKCE, official ChatGPT CIMD, resource and consent scope binding.
- oauth-firestore-store.mjs / oauth-vault.mjs: durable token-state adapter and encrypted Firebase refresh credentials.
- mcp-gateway.mjs / server-runtime.mjs / server-entry.mjs: protected tools, explicit feature gate, startup guards.
