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

## Personal data encryption (2026-11-16)

The shared production backend for Music Core, FANS PICK and ENHYPEN encrypts
winner directory identities and submitted personal fields before storage. Database
triggers encrypt existing/new rows into `pii_box` using a project-specific
OpenPGP RSA-3072 public key and AES-256. Plaintext columns are NULL and database
constraints reject plaintext storage. Verification-session identities and delivery
outbox payloads are covered as well. Lookup hashes and operational metadata remain.
No user-facing HTML, CSS, form fields or request contracts changed in this release.

The private PGP key and the existing Finger King AES key are stored as an
AES-256-GCM wrapped keyset in the private `attendee_privacy` schema. The wrapping
key is derived using HKDF-SHA-256 from BOTH the Edge-injected database URL password
and service-role key. Neither wrapping credential is stored in Postgres or Git.
This uses existing server credentials; it is not an independent KMS or a newly
provisioned dedicated secret. Only the public encryption key is needed for writes.
Finger King keeps its existing AES-GCM ciphertext and claim tokens; its former
plaintext database key has been replaced by a retired marker.

Authorized Edge handlers decrypt only after their existing session/ticket checks.
Large admin responses use the internal `attendee-privacy-decrypt` endpoint in
batches of 20, with concurrency 2 to stay within hosted CPU limits. This endpoint
requires the exact service-role bearer in addition to gateway JWT verification;
the public anon key is insufficient. The shared module pins OpenPGPJS 6.3.2 and
uses native RSA plus browser-build AES-CFB to avoid the Deno AES-CFB runtime issue.
Decrypt responses use `no-store`; no plaintext or key is logged by these handlers.
Administrator data views produce an audit event without personal field values.

### Rotation and restore requirements

- Do not rotate the database password or service-role key independently: the
  wrapped keyset will become unreadable. While the current runtime credentials
  still work, unwrap the existing keyset in a restricted server process and rewrap
  it for the replacement credentials. Keep an encrypted recovery copy in the
  organization's approved secret store. Never put plaintext keys in SQL, Git,
  browser storage or logs.
- Coordinate the credential cutover, replacement of `wrapped_keyset`, and restart
  of all consuming Edge functions (admin, ENHYPEN, delivery worker, Finger King
  and decrypt worker). Validate a synthetic round trip before reopening admin
  operations. Retain the old credentials only in approved recovery custody until
  the cutover is verified. A future dedicated KMS should replace this coupling.
- A database backup alone is intentionally insufficient to decrypt. Restore
  requires the matching runtime credentials or a securely rewrapped keyset.
  Do not run the encryption migration on a fresh project without initializing its
  own keyring and deploying compatible readers first. The one-time bootstrap
  function used for this rollout is disabled and has no reusable public route.

### Limits and validation

This protects a database-only disclosure. A compromised administrator, Edge
runtime, both wrapping credentials, or already exported CSV can expose plaintext.
Earlier backups/WAL may retain old plaintext fields and the former Finger King
root key; this migration does not rewrite historical backups. Existing SHA-256
identity/lookup hashes are not secret-keyed and do not provide protection against
guessing low-entropy inputs. Authorized exports remain plaintext by design.

The rollout verified 421 encrypted rows (110 registrations and 311 directory
records, not unique people) against pre-migration field checksums without exposing
their contents. Fourteen database regression checks exercised new submissions,
duplicate protection, ciphertext storage and encrypted outbox behavior; all test
changes were rolled back. `npm run test:privacy` uses freshly generated synthetic
keys/data to check decryption, tamper/context rejection, wrapping-key rejection,
and administrator response/authentication contracts. Existing registration,
delivery and Finger King synthetic regressions also passed. Live unauthenticated
requests returned 401/403; no new production administrator account was created.
