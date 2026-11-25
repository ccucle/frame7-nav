# FORMDAY v0.8.27 — AI 식단 가져오기

- 날짜 상세 > 식단 영양 > AI 식단 가져오기. Paste one JSON object in the `formday-ai-meal-v1` format; a JSON Markdown fence also works. Load preview, review dates/times/foods/estimated nutrients, explicitly save as a completed meal.
- Null dates are presented as the selected detail date and remain editable; null times are blank and require an actual start/end time. Completed meal dates after today's Seoul date are rejected. Nutrition values are per entered amount, not per 100g. Unknown values are null. Supported units: g/ml/serving. Sources: photo_estimate/estimate/user_label/unknown.
- New meals only, max 50 items. Same-date identical food/portion signature or overlapping existing meal interval blocks the import (including actual recurring occurrences; samples excluded). This is intentionally conservative; use the normal meal editor for a real additional identical or overlapping meal. No overwrite, replacement, photo upload, backup import, or nutrition catalog modification.
- Existing revision-checked calendar commit, local backup, local reread, and Google opt-in sync are reused. Local save is not cloud acknowledgement; check existing device sync, conflicts, quota, and identity. No new backend, endpoint, billing, credentials or security-rule changes. Actual owner account cloud sync and mobile layout need live user verification.
- Preserve existing photo pilot and pending photo PR #39 separately; rebase that draft before any future merge.

All test data are synthetic. No personal meal records or credentials are in this change.
