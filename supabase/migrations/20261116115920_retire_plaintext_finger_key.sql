-- Edge readers must already use the wrapped keyset. Preserve the original key
-- inside that keyset so existing winner tokens and AES-GCM records still work.
update finger_king.configuration
set secret = 'retired:edge-wrapped-keyset-v1'
where singleton
  and exists (
    select 1 from attendee_privacy.keyring
    where id = 'v1' and length(wrapped_keyset) > 1000
  );
