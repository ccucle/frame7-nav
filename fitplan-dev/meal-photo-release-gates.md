# FORMDAY meal photo — staged implementation, NOT deployed
Base: fitplan-site-20261123 at 30f04e7e560fc07ad10212ebf6260b58067297fc.
Scope: one original JPEG/PNG/WebP (<=700 KiB) attached to a previously saved, synchronized, completed, non-sample, non-repeating meal. New-meal and recurring-meal photo creation, HEIC/larger originals, and Connect upload are release gates. No personal photo or record is included here.

## Storage
Use existing Firebase project/database/Google account. Store the original bytes in users/{uid}/formday_meal_photos/{eventId}; calendar and iron payload formats are unchanged. No public URLs, base64 in calendar JSON, or localStorage image storage. Keep EXIF intact to preserve the original (warn about metadata before launch). Open a meal to fetch the private document; use local Blob URL, revoke on account change/close. Photo editing is a distinct explicit operation, not the meal's Save button.

Owner-only get/create/update/delete. No list permission. The calendar is a JSON-string field so Rules cannot inspect the embedded event; the client checks exact unique saved real meal and date in a transaction. Treat the rules fragment as an additive proposal only; never overwrite current production rules or assume the client-side meal check is a server authorization guarantee. For cloud Connect, require a trusted per-user authenticated path and independently validate the record.

Writes check old digest, use a stable ID and verify SHA-256 from actual server bytes after transaction. No blind retry after uncertain response. Source app rejects files beyond 700 KiB rather than silently converting. Normal date moves preserve ID association. Photo removal is separate; deleting a meal leaves its photo for undo, so define explicit orphan cleanup (including type/recurrence changes) and backup/export before release. No photo object is uploaded automatically.

## Release gates (all pending)
1. Review current deployed rules and Spark plan; test merged rules in emulator for owner vs anonymous/unrelated UID, invalid field/size, create, update, delete, and regression of existing calendar/iron rules. Verify no broad overlapping allow. Add index exemption for bytes field through existing index config only after verifying existing indexes. Never enable paid billing; quota failures stop cleanly.
2. Test full app with synthetic JPEG/PNG/WebP fixtures, decode and exact hash, date move, cancel, account switch, race, permission denial, offline, interrupted save, replacement/deletion and undo. Verify orphan cleanup/backup and recurrence decisions. Test iPhone Safari.
3. Inspect the actual production FORMDAY Connect Sites source (the historical GitHub MCP drafts are NOT its confirmed live source). Add an authenticated file-input/upload using the original byte payload and exact saved meal ID. For new meal save, preserve the same idempotent meal request ID, attach only after matching calendar readback, retain partial state if photo fails, and retry only the attachment. Do not change plugin's claim until the runtime route and uploads are verified. Do not send photos to public URLs, external services, repository or logs.
4. Deploy both surfaces only after the above, verify private account and real cross-device readback, then test the requested meal/photo only with user authorization and duplicate check.

## Current verification
22 assertions for pure validation and optimistic write decisions were run in isolated V8 against the function used to generate meal-photo-policy.js. Native Node suite, Firebase emulator, full-browser integration, actual Sites server, current production rules, and live deployment not verified. The proposed Rules fragment is not the complete Rules file. No existing production data or billing settings changed.
