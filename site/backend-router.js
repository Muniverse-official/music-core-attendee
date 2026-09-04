(() => {
  'use strict';

  const LEGACY_ORIGIN = 'https://tcxugltvmatbgsmcepso.supabase.co';
  const ACTIVE_ORIGIN = 'https://kkaoerbblpuszptiibvo.supabase.co';
  const LEGACY_PATH = '/functions/v1/music-core-attendee';
  const VERIFY_ENDPOINT = `${ACTIVE_ORIGIN}/functions/v1/music-core-attendee-verify`;
  const REGISTER_ENDPOINT = `${ACTIVE_ORIGIN}/functions/v1/music-core-attendee-register-v2`;
  const nativeFetch = window.fetch.bind(window);

  function route(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl, window.location.href);
    } catch {
      return rawUrl;
    }

    if (url.origin !== LEGACY_ORIGIN || url.pathname !== LEGACY_PATH) return rawUrl;
    const action = url.searchParams.get('action');
    if (action === 'verify') return VERIFY_ENDPOINT;
    if (action === 'submit') return REGISTER_ENDPOINT;
    return rawUrl;
  }

  window.fetch = (input, init) => {
    if (typeof input === 'string' || input instanceof URL) {
      return nativeFetch(route(String(input)), init);
    }

    if (input instanceof Request) {
      const routedUrl = route(input.url);
      if (routedUrl !== input.url) return nativeFetch(new Request(routedUrl, input), init);
    }
    return nativeFetch(input, init);
  };

  Object.defineProperty(window, '__MUSIC_CORE_BACKEND_SPLIT__', {
    value: Object.freeze({ verify: VERIFY_ENDPOINT, register: REGISTER_ENDPOINT }),
    configurable: false,
    enumerable: false,
    writable: false
  });
})();
