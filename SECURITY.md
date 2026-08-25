# Security

The public site is static and served by GitHub Pages. Registration requests are handled only by Supabase Edge Functions.

Implemented controls:

- strict origin and custom-header checks
- 16 KB request-body limit and JSON validation
- per-IP rolling rate limits plus one-minute burst limits
- hidden honeypot field for automated submissions
- one-time 15-minute verification tokens bound to IP and user agent
- SHA-256 winner identity matching; winner emails and nicknames are not exposed by the API
- duplicate submission prevention at both API and database levels
- RLS enabled and direct `anon`/`authenticated` table access revoked
- no service-role key or webhook secret in browser code or the repository
- audit records contain request identifiers and hashed network fingerprints, not raw IP addresses

Provider-level volumetric DDoS mitigation is supplied by GitHub Pages and Supabase. Application-level throttling limits brute-force and abusive requests. For a future custom domain, an additional WAF/CAPTCHA layer can be placed in front without changing the winner database.

Report security issues privately to support@muniverse.io.
