# FORMDAY Connect — scoped MCP/OAuth backend

**2026-11-24 (Asia/Seoul): source v0.4.0 with mobile-route verification, read-correctness fixes and mandatory post-save reread. 86 synthetic tests pass locally on Node 24. Connect server not deployed; no live Firebase connection or mobile read/write success. The separately available FORMDAY skill prepares drafts only. Additional monthly operating budget: KRW 0.**

[Zero-cost route and post-save verification](PHASE6-ZERO-COST.md) · [Mobile-route and read verification](PHASE5-MOBILE-REVIEW.md) · [Phase 5 append implementation and limitations](PHASE5-APPEND.md) · [Phase 4 security review](PHASE4-REVIEW.md)

## User-facing behavior

- Six read tools for cloud status, actual workouts, routines/programs, calendar, meals and weight history.
- Calendar/meal/weight reads follow the site's actual recurring dates, exclusions, occurrence snapshots and completion semantics. Dates default to Asia/Seoul; meal portions retain their stored units. Coaching is lower priority than accurate lookup and requested registration.
- Optional previews for adding an existing routine to a dated calendar, creating a program from existing routines, and adding a consumed meal.
- One commit tool saves exactly the previewed addition. No tools edit/delete existing items or manufacture completed workout sessions.
- Meal photos are interpreted in ChatGPT. The backend accepts structured foods and portions, labels estimates, and preserves unknown nutrients as null. No image upload or separate image-model API is implemented.
- PC and iPhone must both be verified before release. Local code installation does not establish mobile availability.

## Scope and data protection

Default is read-only. The exact server setting FORMDAY_ENABLE_APPEND=true AND a new OAuth consent granting formday:read formday:append are required to expose the four append tools. Existing read grants remain read-only. The consent page reads the stored flow and displays the requested permissions.

The signed preview binds user, MCP resource, exact entry, payload hash, snapshot revision and Firestore updateTime. New writes expire after ten minutes. Reusing the same preview can check whether that exact entry already exists, even after expiry, without another write. A fresh preview is a distinct operation; it is not a global duplicate detector.

After a successful conditional commit, the same authenticated document is read again. `saved` requires exactly one matching ID and unchanged entry, and includes `readBackVerified: true` with the observed document revision. Unrelated later edits are preserved. Failed or mismatched rereads never return success. An unknown POST outcome is not automatically resent; the SAME preview reconciles the existing entry, returning `already_saved` only after verification.

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

1. No Connect web service, isolated OAuth storage or production secrets have been provisioned. The latest observed Render deployment is FORMDAY v0.7.1 commit `ca4e67cdf5020b0a0147832e8650ea7931a894c7` from another task (2026-11-24 10:05:26 KST). Preserve the latest live site and all Firebase data/rules/authentication settings. Never deploy this branch's older `fitplan/` over it. The user requires KRW 0 additional monthly costs. Workers Free plus SQLite Durable Objects is a conditional candidate; actual Cloudflare subscription and Firebase Spark/Blaze status remain unverified. No paid plan, trial, billing link or automatic upgrade is authorized.
2. OAuth token-bundle issuance is not atomic; grant-family revocation, concurrent Firebase credential rotation, request limits and expired-secret cleanup still require implementation and failure testing. This remains development code, with writes disabled by default.
3. Actual Google browser login, authorized domains, exact ChatGPT callback/CIMD registration, live Firestore rules and owner-account read/write smoke tests remain unverified. Selecting a new Google account can create a Firebase Auth user; first-login prevention remains unresolved.
4. The website requires cloud download to apply remote records. Local unsynced changes may conflict; active IRON sessions can block download. No automatic site refresh was added.
5. Direct custom MCP connections are documented as web-only, while account-available cloud plugins support mobile Chat/Work. The external HTTPS MCP/OAuth plugin format is documented, but this account's endpoint discovery, installation, authorization and iPhone invocation remain unverified. Sites has future overage charges with no confirmed zero-cost hard stop, so it is not the selected hosting route. The current FORMDAY skill has no live access tool.
6. The post-save reread contract is now implemented and tested with synthetic records. Cross-preview duplicate prevention, latest live-schema write preservation, actual owner-account writes and two-device read-back remain unverified. Keep writes disabled until real authenticated reads and these gates are complete.

## Main modules

- reader.mjs / tools.mjs: bounded owner reads, Korea calendar defaults, meal amounts/source evidence, program summaries.
- append.mjs: strict preview schemas, signed capability, append-only transformations and conflict/retry behavior.
- firebase-rest.mjs / firebase-append.mjs: verified Firebase identity, two-document reads, conditional user-token REST commit.
- oauth-core.mjs / oauth-http.mjs: PKCE, official ChatGPT CIMD, resource and consent scope binding.
- oauth-firestore-store.mjs / oauth-vault.mjs: durable token-state adapter and encrypted Firebase refresh credentials.
- mcp-gateway.mjs / server-runtime.mjs / server-entry.mjs: protected tools, explicit feature gate, startup guards.
