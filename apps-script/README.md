# Muniverse attendee dispatcher (Apps Script v8)

This Apps Script receives signed attendee registration webhooks and writes each completed registration into a **program-specific spreadsheet / round-specific tab**.

## Sheet structure

### SHOW! MUSIC CORE

- Spreadsheet: `쇼! 음악중심 방청자 등록 명단`
- Spreadsheet ID: `191598ZPdnCdDlvoa8aFGGNPmT1_xqEZXOq7vvEEahp0`
- Tabs: `963회차`, `964회차`, `965회차` ...

### FANS PICK

- Spreadsheet: `FANS PICK 방청자 등록 명단`
- Spreadsheet ID: `1GsFyGTLeJV62T9xsfFyvsxOljRy3Egr7MkahpttlrPs`
- Tabs: `1회차`, `2회차`, `3회차` ...

Each tab belongs to one `round_id`. The round ID is stored as Google Sheets developer metadata, so renaming a round does not disconnect its data.

## Round-tab behavior

- `round_id` and `round_title` are required in the webhook payload.
- On the first completed attendee registration for a round, the script creates that round's tab if it does not already exist.
- New round tabs are inserted at the **leftmost position**, so the newest round is the first tab administrators see.
- Existing round tabs remain untouched and preserve all prior registrations.
- The first four rows of each round tab are reserved for round metadata and headers:
  1. Round title
  2. Attendance date
  3. Registration window in KST
  4. Column headers
- Registration rows start at row 5.
- Internal idempotency columns are hidden.
- Notification email links point directly to the matching round tab using its `gid`.

## Script Properties

Required:

- `WEBHOOK_TOKEN`: shared webhook secret.

Recommended:

- `NOTIFY_EMAIL`: notification address. Defaults to `support@muniverse.io`.
- `FANS_PICK_SHEET_ID`: FANS PICK spreadsheet ID. The legacy sheet is reused if accessible.
- `FANS_PICK_FOLDER_ID`: destination folder if a FANS PICK spreadsheet ever has to be created.

## Duplicate protection

The dispatcher checks the idempotency key **inside the target round tab** before appending a row. A retried webhook therefore cannot create a second row in the same round.

## Deployment

After updating `Code.gs`, deploy a **new web-app version** from each existing Apps Script project that serves the production `/exec` webhook URL. Updating the deployment to the new version preserves the `/exec` URL, so Supabase does not need a URL change.

## Post-event deletion

- FANS PICK: `purgeFansPickRound('2회차')`
- Legacy first-round helper: `purgeFansPickData()`
- SHOW! MUSIC CORE: `purgeMusicCoreEvent('YYYY-MM-DD')`

These functions clear registration rows while keeping the round tab and its header structure.