(() => {
  'use strict';
  const LEGACY_ORIGIN = 'https://tcxugltvmatbgsmcepso.supabase.co';
  const ACTIVE_ORIGIN = 'https://kkaoerbblpuszptiibvo.supabase.co';
  const LEGACY_PATH = '/functions/v1/music-core-attendee';
  const PINNED = `${ACTIVE_ORIGIN}/functions/v1/attendee-public?forceFunctionRegion=ap-northeast-2&program=music_core`;
  const nativeFetch = window.fetch.bind(window);
  function route(rawUrl) {
    let url;
    try { url = new URL(rawUrl, window.location.href); } catch { return rawUrl; }
    if (url.origin !== LEGACY_ORIGIN || url.pathname !== LEGACY_PATH) return rawUrl;
    const action = url.searchParams.get('action');
    if (action === 'verify') return `${PINNED}&action=verify`;
    if (action === 'submit') return `${PINNED}&action=submit`;
    return rawUrl;
  }
  function unpin(url) {
    try { const u=new URL(url); u.searchParams.delete('forceFunctionRegion'); return u.toString(); } catch { return url; }
  }
  function platformFailure(response) {
    return response.status >= 500 && !response.headers.get('x-attendee-revision');
  }
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  window.fetch = async (input, init) => {
    if (typeof input === 'string' || input instanceof URL) {
      const original=String(input),routed=route(original);
      const response=await nativeFetch(routed,init);
      if(routed!==original&&platformFailure(response)){await wait(200+Math.random()*800);return nativeFetch(unpin(routed),init)}
      return response;
    }
    if (input instanceof Request) {
      const routedUrl = route(input.url);
      if (routedUrl !== input.url) {
        const first=new Request(routedUrl,input),second=first.clone();
        const response=await nativeFetch(first,init);
        if(platformFailure(response)){await wait(200+Math.random()*800);return nativeFetch(new Request(unpin(routedUrl),second),init)}
        return response;
      }
    }
    return nativeFetch(input, init);
  };
  Object.defineProperty(window, '__MUSIC_CORE_BACKEND_SPLIT__', {
    value: Object.freeze({ verify: `${PINNED}&action=verify`, register: `${PINNED}&action=submit` }),
    configurable: false, enumerable: false, writable: false
  });
})();
