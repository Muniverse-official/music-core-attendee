# SHOW! MUSIC CORE attendee registration

Independent Muniverse winner verification and attendee registration service for SHOW! MUSIC CORE.

- Public site: `site/`
- Supabase Edge Functions: `supabase/functions/attendee-public/` and `supabase/functions/attendee-admin/`
- Google Apps Script dispatcher: `apps-script/`
- Winner import: `tools/import_winners.py`
- Post-event deletion: `tools/purge_attendee_data.py` and the Apps Script purge functions
- Database hardening migration: `supabase/migrations/20260825093000_attendee_security_hardening.sql`

GitHub Pages publishes only `site/`. Winner emails and nicknames are converted to SHA-256 lookup hashes before import. A submitted winner cannot reopen or change the registration and sees only a completed-registration notice.

## Music Core registrations and reserve winners

The administrator's per-round winner area separates Primary and Reserve lists. Both groups verify their email and nickname, then use the same registration form for name, birth date, nationality, phone, X account, and contact email. Reserve registration stays classified as reserve, and attendance is confirmed only after an individual final-selection notice. Notices are translated into Korean, English, Japanese, Traditional Chinese, and Simplified Chinese.

The **방청자 정보** tab displays registered attendees for the selected round, including the original registration identity, age, and KST registration time. Administrators can search, filter Primary/Reserve, and download the displayed records as UTF-8 CSV. Promotion retains the existing record and updates its classification without requiring another submission.

Music Core registrations are stored in the database and no longer enqueue Google Sheets or the associated operator email. Existing spreadsheet data is not deleted. Legacy Music Core delivery jobs cannot be dispatched or retried. FANS PICK retains its existing delivery workflow.

Checks: `node tools/qa-reserve-edge.mjs`, `node tools/reserve-ui-smoke.mjs` (Playwright), and `tools/qa-reserve-database.sql` (transaction with rollback).
