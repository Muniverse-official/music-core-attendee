# Muniverse attendee dispatcher

This Apps Script keeps the existing COVER PICK webhook compatible and adds the Music Core monthly spreadsheet flow.

## Deployment

1. Replace the current Web App project code with `Code.gs`.
2. Keep the existing `WEBHOOK_TOKEN` Script Property unchanged.
3. Optionally set `MUSIC_CORE_FOLDER_ID` to the Drive folder that should contain the monthly spreadsheets.
4. Deploy a new Web App version to the existing deployment URL.
5. Set the same token in the Supabase Edge Function secret named `MUSIC_CORE_WEBHOOK_TOKEN`.

Requests without `kind` continue to use `cover_pick`, so the current COVER PICK Edge Function remains backward-compatible. Music Core requests use `kind=music_core` and deduplicate rows with `idempotency_key`.
