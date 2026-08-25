# SHOW! MUSIC CORE attendee registration

Independent Muniverse winner verification and attendee registration service for SHOW! MUSIC CORE.

- Public site: `site/`
- Supabase Edge Function: `supabase/functions/music-core-attendee/`
- Google Apps Script dispatcher: `apps-script/`
- Winner import: `tools/import_winners.py`
- Post-event deletion: `tools/purge_attendee_data.py` and the Apps Script purge functions
- Database hardening migration: `supabase/migrations/20260825093000_attendee_security_hardening.sql`

GitHub Pages publishes only `site/`. Winner emails and nicknames are converted to SHA-256 lookup hashes before import. A submitted winner cannot reopen or change the registration and sees only a completed-registration notice.
