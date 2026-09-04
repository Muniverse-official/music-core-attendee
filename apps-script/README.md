# Muniverse attendee dispatcher (Apps Script v7)

This Apps Script receives signed webhooks from the Supabase Edge Functions and writes completed attendee registrations to Google Sheets.

## Script Properties

Required:

- `WEBHOOK_TOKEN`: shared webhook secret. Use the same value as the relevant Supabase function secret/runtime config.

Recommended:

- `NOTIFY_EMAIL`: notification address. Defaults to `support@muniverse.io` when omitted.
- `FANS_PICK_SHEET_ID`: existing FANS PICK Google Sheet ID. When omitted, the script reuses the legacy sheet when accessible or creates a new sheet.
- `FANS_PICK_FOLDER_ID`: destination folder for a newly created FANS PICK sheet.

## SHOW! MUSIC CORE

Music Core uses one dedicated spreadsheet rather than creating a new file per month.

- Spreadsheet: `쇼! 음악중심 방청자 등록 명단`
- Spreadsheet ID: `191598ZPdnCdDlvoa8aFGGNPmT1_xqEZXOq7vvEEahp0`
- Sheet: `방청자 등록`
- Columns: 녹화일 / Muniverse 닉네임 / 가입 이메일 / 이름 / 만 나이 / 생년월일 / 국적 / 연락처 / X 계정 / 방청 안내용 이메일 / 내부 중복방지용 등록키 / 등록 시각
- The idempotency-key column is hidden.
- Every successful new Music Core registration appends exactly one row.
- Duplicate webhook delivery does not append a second row.
- Every successful new Music Core registration sends an email to `NOTIFY_EMAIL` or `support@muniverse.io`.

## Behavior

- Accepts `fans_pick`, legacy `cover_pick`, and `music_core` webhook kinds.
- Prevents replay with a timestamp and one-time nonce.
- Uses an idempotency key so the same registration is not appended twice.
- FANS PICK behavior remains unchanged.

## Deployment

After updating `Code.gs`, deploy a **new web-app version** from the existing Apps Script project. If the existing deployment is edited to point to the new version, its `/exec` URL remains unchanged and no Supabase URL change is required.

The production Supabase `music-core-attendee-register` function currently calls the shared Apps Script dispatcher using `kind: music_core`.

## Post-event deletion

After attendee verification and final guidance are complete, run `purgeFansPickData()` or `purgeMusicCoreEvent('YYYY-MM-DD')` in Apps Script. Music Core uses a single dedicated sheet, so `purgeMusicCoreEvent()` removes only rows matching that recording date.
