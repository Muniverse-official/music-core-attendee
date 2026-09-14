# SHOW! MUSIC CORE attendee registration

Independent Muniverse winner verification and attendee registration service for SHOW! MUSIC CORE.

- Public site: `site/`
- Supabase Edge Function: `supabase/functions/music-core-attendee/`
- Google Apps Script dispatcher: `apps-script/`
- Winner import: `tools/import_winners.py`
- Post-event deletion: `tools/purge_attendee_data.py` and the Apps Script purge functions
- Database hardening migration: `supabase/migrations/20260825093000_attendee_security_hardening.sql`

GitHub Pages publishes only `site/`. Winner emails and nicknames are converted to SHA-256 lookup hashes before import. A submitted winner cannot reopen or change the registration and sees only a completed-registration notice.

## Music Core reserve winners

The administrator's per-round winner area has separate Primary and Reserve lists. Entries default to primary; adding the same identity to a different list is rejected. Reserve entries can be imported, edited, deleted, and exported independently. The administrator can explicitly promote a reserve entry to primary after confirming a vacancy. Promotion is logged and does not send a message.

During the existing announcement window, an exact email/nickname match on the reserve list displays a localized reserve notice and the promise of individual contact if a primary winner fails to register. It issues no registration token. The registration RPC and an attendee-table trigger both reject reserve entries. A promoted entry uses the existing round's registration window; operators must set the appropriate window before inviting that person to register. Existing winner records, completed registrations, and FANS PICK behavior retain their prior meanings.

Checks: `node tools/qa-reserve-edge.mjs`, `node tools/reserve-ui-smoke.mjs` (Playwright), and `tools/qa-reserve-database.sql` (transaction with rollback).
