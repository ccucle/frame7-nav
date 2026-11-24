# FORMDAY v0.7.1

2026-11-24 (Asia/Seoul). Small follow-up from the live v0.7.0 acceptance checks.

- Replace the exercise library's obsolete Unsplash/representative-photo footer with the actual SVG artwork authors, CC BY-SA 4.0 license, and per-exercise credits link. Homepage Unsplash photography retains its own correct attribution.
- After explicitly discarding an edited routine/program draft, replace the stale “exercises added; save the routine” message with a cancellation message. Declining discard keeps the draft and prior message; successful saves keep their success message.
- Bump the displayed version and changed script cache keys to v0.7.1.

Validation: Node.js v24.22.3, **182 tests passed / 0 failed**, including the live-discovered two-exercise draft-cancellation regression. Changed JavaScript syntax and `git diff --check` passed.

v0.7.0 live checks already completed: 83 published files matched the reviewed source byte-for-byte; workout/submenu routing, routine editing, Korean-initial exercise search, image loading, independent favorite toggles, favorite persistence across picker openings, multiselect across changed searches, canceled selection with draft preservation, two-exercise addition to the draft, graph range changes, target dialog, and the exercise library were exercised in the public Chrome browser. The test draft was canceled without saving a routine; the test favorite was removed. No actual Google account or personal Firebase records were used.

The browser's organization policy disallows DevTools, so device emulation was not used. Actual iPhone Safari/ChatGPT in-app behavior and account synchronization remain outside this browser validation. Mobile CSS, safe-area support, keyboard viewport handling, and chart coordinate bounds have implementation/automated coverage, not an actual-device pass.
