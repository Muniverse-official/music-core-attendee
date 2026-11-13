function createEnhypenAdmin({getToken, onExpired, beforeSwitch}) {
  const api = 'https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/attendee-private-test';
  const dashboard = document.getElementById('dashboard');
  const tabs = dashboard.querySelector('nav[aria-label="프로그램 선택"]');
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.hidden = true;
  tab.setAttribute('aria-pressed', 'false');
  tabs.append(tab);
  const existing = document.createElement('div');
  const settings = dashboard.querySelector('.extra');
  dashboard.insertBefore(existing, tabs.nextElementSibling);
  while (existing.nextElementSibling && existing.nextElementSibling !== settings) existing.append(existing.nextElementSibling);
  const panel = document.createElement('section');
  panel.className = 'card';
  panel.hidden = true;
  panel.innerHTML = `<div class="section-head"><div><h2 id="privateTestTitle">비공개 테스트</h2><span id="enhypenTestStatus" class="badge"></span></div><button id="enhypenTestRefresh" class="secondary" type="button">새로고침</button></div>
  <p class="notice">비공개 테스트 · 가상 당첨 확인 횟수만 집계합니다.</p>
  <div class="stats"><div><span>테스트 당첨 확인</span><strong id="enhypen-verifications">0</strong></div></div>
  <div class="actions"><button id="enhypenTestOpen" type="button">비공개 테스트 페이지 열기</button><button id="enhypenTestPause" class="secondary" type="button">테스트 일시정지</button></div>
  <p id="enhypenTestMessage" role="status" class="message"></p>`;
  dashboard.insertBefore(panel, settings);
  const message = document.getElementById('enhypenTestMessage');
  const pause = document.getElementById('enhypenTestPause');
  const open = document.getElementById('enhypenTestOpen');
  const refresh = document.getElementById('enhypenTestRefresh');
  let active = false;
  let state;
  let operation = 0;
  let loading = false;
  let expiryTimer;

  function setLoading(value) {
    loading = value;
    pause.disabled = loading || !state;
    refresh.disabled = loading;
    open.disabled = loading || !state;
  }

  async function request(body) {
    const token = getToken();
    if (!token) throw new Error('관리자 로그인이 필요합니다.');
    const result = await fetch(api, {
      method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: {authorization: `Bearer ${token}`, 'content-type':'application/json', 'x-admin-request':'1'},
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    if (result.status === 401 && token === getToken()) onExpired();
    const data = await result.json();
    if (!result.ok || !data.ok) throw new Error(`테스트 정보를 불러오거나 저장하지 못했습니다. (${data.code || result.status})`);
    return data;
  }

  function render(next) {
    state = next;
    document.getElementById('enhypen-verifications').textContent = state.verifications.toLocaleString('ko-KR');
    pause.textContent = state.paused ? '테스트 재개' : '테스트 일시정지';
    document.getElementById('enhypenTestStatus').textContent = state.paused ? '일시정지' : '진행 중';
  }

  async function run(body) {
    if (loading || !active) return;
    const id = ++operation;
    const token = getToken();
    setLoading(true);
    message.textContent = '처리 중…';
    try {
      const data = await request(body);
      if (!active || id !== operation || token !== getToken()) return;
      render(data.state);
      message.textContent = '';
    } catch (error) {
      if (id === operation && active) {
        message.textContent = error.message;
      }
    } finally {
      if (id === operation) setLoading(false);
    }
  }

  function leave() {
    ++operation;
    active = false;
    state = undefined;
    setLoading(false);
    panel.hidden = true;
    existing.hidden = false;
    tab.setAttribute('aria-pressed', 'false');
  }

  tab.onclick = async () => {
    if (active || !getToken() || !await beforeSwitch()) return;
    active = true;
    existing.hidden = true;
    panel.hidden = false;
    tab.setAttribute('aria-pressed', 'true');
    document.querySelectorAll('[data-program]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    await run({action:'state'});
  };
  pause.onclick = () => run({action:'pause', paused:!state.paused});
  refresh.onclick = () => run({action:'state'});
  open.onclick = () => { location.assign('../private-test/'); };

  return {
    leave,
    get active() { return active; },
    hide() { tab.hidden = true; leave(); },
    async enable() {
      const token = getToken();
      try {
        const data = await request({action:'state'});
        if (token === getToken() && data.title) {
          tab.textContent = data.title;
          document.getElementById('privateTestTitle').textContent = data.title.replace(/^\d+\.\s*/, '');
          tab.hidden = false;
          if (location.hash === '#private-test' && !active) await tab.onclick();
        }
      } catch { /* The existing programs stay available if the optional test service is offline. */ }
    },
    expireAt(value) {
      clearTimeout(expiryTimer);
      if (!value) return;
      const delay = Date.parse(value) - Date.now();
      if (Number.isFinite(delay)) expiryTimer = setTimeout(onExpired, Math.max(0, delay));
    },
  };
}
