(() => {
  'use strict';
  const LEGACY_ORIGIN = 'https://tcxugltvmatbgsmcepso.supabase.co';
  const ACTIVE_ORIGIN = 'https://kkaoerbblpuszptiibvo.supabase.co';
  const LEGACY_PATH = '/functions/v1/music-core-attendee';
  const BASE = `${ACTIVE_ORIGIN}/functions/v1/attendee-public?program=music_core`;
  const nativeFetch = window.fetch.bind(window);
  function route(rawUrl) {
    let url;
    try { url = new URL(rawUrl, window.location.href); } catch { return rawUrl; }
    if (url.origin !== LEGACY_ORIGIN || url.pathname !== LEGACY_PATH) return rawUrl;
    const action = url.searchParams.get('action');
    if (action === 'verify') return `${BASE}&action=verify`;
    if (action === 'submit') return `${BASE}&action=submit`;
    return rawUrl;
  }
  window.fetch = (input, init) => {
    if (typeof input === 'string' || input instanceof URL) return nativeFetch(route(String(input)), init);
    if (input instanceof Request) {
      const routedUrl = route(input.url);
      if (routedUrl !== input.url) return nativeFetch(new Request(routedUrl, input), init);
    }
    return nativeFetch(input, init);
  };
  Object.defineProperty(window, '__MUSIC_CORE_BACKEND_SPLIT__', {
    value: Object.freeze({ verify: `${BASE}&action=verify`, register: `${BASE}&action=submit` }),
    configurable: false, enumerable: false, writable: false
  });
})();
