# FORMDAY Connect — read-only ChatGPT integration foundation

**Status:** source implemented, not deployed, not connected to ChatGPT or live Firestore.

## Goal
- Coach from the user's FORMDAY Google-account-bound records in ChatGPT, on both PC and iPhone.
- Read first; add explicit user-approved future plan changes later. Historical actual exercise, meal and weight entries remain protected.
- Reuse existing Firebase Spark and FORMDAY v0.6.0, without new OpenAI API fees in the website.

## Implemented modules
- `src/reader.mjs`: bounded and strictly read-only views of `users/{verifiedUid}/formday_sync/calendar` and `iron`.
- `src/tools.mjs`: six read-only tool declarations; rejects arbitrary user IDs, paths, and unknown tool names.
- `src/firebase-adapter.mjs`: Firebase Admin server-side reader allowing only the exact Firestore document shape.
- `test/reader.test.mjs`: synthetic-data unit tests. No Firebase credentials or real user data involved.

Tools: `formday_status`, `formday_workouts`, `formday_routines`, `formday_calendar`, `formday_meals`, `formday_weight_history`.
IRON MODE workout volume sums only completed non-warmup sets. Calendar recurrence is not expanded; nutrients are not guessed.

## Security prerequisites before a live connection
1. Host a remotely reachable MCP Streamable HTTP server on HTTPS. This repository has **no hosted MCP endpoint yet**.
2. Support an OAuth 2.1/OIDC authorization flow usable by ChatGPT, with access and refresh token handling.
3. In the server, verify each client authorization and bind a verified Firebase UID. **Never accept UID from a model tool argument**.
4. Initialize Firebase Admin SDK on the server only, with secret credentials in a safe runtime. Admin SDK bypasses Firestore Security Rules: restrict both IAM and allowed paths.
5. Rate-limit reads, omit sensitive payloads from logs, and restrict tool access to a verified owner.
6. Verify reads using the actual user's current Firestore snapshots, then test the same installed plugin in iPhone ChatGPT.
7. Only after these steps, develop version-checked, user-approved future routine/calendar writes. No raw document replacement.

## PC and iPhone gate
Current OpenAI documentation says direct custom MCP server connection is web-only, and some custom app capabilities are web-only. Mobile tool usability is **unverified**. Do not call this project complete before iPhone testing.

## Current environment blocker
The ChatGPT Sites MCP hosting tool and skill are not available in this conversation. Accordingly no placeholder endpoint, OAuth credentials, fake plugin or installation should be created. The code is preserved in a dedicated GitHub branch for the next build step.

## Test
Use Node.js 20+ in this directory: `npm test`. No account or network needed.

Official references:
- https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt
- https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
- https://firebase.google.com/docs/auth/admin/verify-id-tokens
- https://firebase.google.com/docs/firestore/security/rules-conditions
