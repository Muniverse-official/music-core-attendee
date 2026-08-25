# Muniverse attendee dispatcher (Apps Script v5)

This Apps Script receives signed webhooks from the Supabase Edge Functions and writes completed attendee registrations to Google Sheets.

## Script Properties

Required:

- `WEBHOOK_TOKEN`: shared webhook secret. Use the same value as the relevant Supabase function secret.

Recommended:

- `NOTIFY_EMAIL`: email address that receives the Google Sheet link when the first attendee submits. Defaults to `support@muniverse.io` when omitted.
- `FANS_PICK_SHEET_ID`: existing FANS PICK Google Sheet ID. When omitted, the script reuses the legacy sheet when accessible or creates a new sheet.
- `FANS_PICK_FOLDER_ID`: destination folder for a newly created FANS PICK sheet.
- `MUSIC_CORE_FOLDER_ID`: destination folder for newly created Music Core sheets.

## Behavior

- Accepts `fans_pick`, legacy `cover_pick`, and `music_core` webhook kinds.
- Prevents replay with a timestamp and one-time nonce.
- Uses an idempotency key so the same registration is not appended twice.
- Sends the sheet link only once, when registration begins for that FANS PICK sheet or Music Core recording date.
- User-facing sheet and email labels use **FANS PICK**.

After updating `Code.gs`, deploy a new web-app version and keep the web-app URL in the Supabase `ATTENDEE_APPS_SCRIPT_URL` secret when it differs from the current default.

## Post-event deletion

After attendee verification and final guidance are complete, run `purgeFansPickData()` or `purgeMusicCoreEvent('YYYY-MM-DD')` in Apps Script to clear Google Sheet rows. Purge the corresponding Supabase rows with `tools/purge_attendee_data.py` in the relevant repository.
