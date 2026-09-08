(() => {
  'use strict';
  const API = 'https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/attendee-config?program=music_core';
  const COPY = {
    ko: { notOpen: '방청자 당첨 확인 기간이 아닙니다.', closed: '방청자 당첨 확인 및 정보 등록 기간이 종료되었습니다.', unavailable: '연결을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.' },
    en: { notOpen: 'Winner verification is not currently available.', closed: 'Winner verification and registration have closed.', unavailable: 'Could not check availability. Please try again shortly.' },
    ja: { notOpen: '現在は当選者確認期間ではありません。', closed: '当選者確認・登録期間は終了しました。', unavailable: '接続を確認できません。しばらくしてから再度お試しください。' },
    'zh-TW': { notOpen: '目前不在中獎者確認期間。', closed: '中獎確認與登記期間已結束。', unavailable: '無法確認連線，請稍後再試。' },
    'zh-CN': { notOpen: '当前不在中奖者确认期间。', closed: '中奖确认与登记已结束。', unavailable: '无法确认连接，请稍后重试。' }
  };
  let config = null;
  let blocked = false;
  let loadFailed = false;
  let loading = false;
  let loadedAt = 0;
  const $ = (id) => document.getElementById(id);
  const copy = () => COPY[$('lang')?.value || 'ko'] || COPY.en;
  function state() {
    if (!config || Date.now() - loadedAt > 90000) return loadFailed ? 'UNAVAILABLE' : 'LOADING';
    const now = Date.now();
    const open = config.openAt ? Date.parse(config.openAt) : NaN;
    const close = config.closeAt ? Date.parse(config.closeAt) : NaN;
    if ((config.openAt && !Number.isFinite(open)) || (config.closeAt && !Number.isFinite(close))) return 'UNAVAILABLE';
    // Match the server: testing allows early access, not access after the deadline.
    if (Number.isFinite(close) && now >= close) return 'CLOSED';
    if (config.testMode === true) return 'OPEN';
    if (Number.isFinite(open) && now < open) return 'NOT_OPEN';
    return 'OPEN';
  }
  function hideSchedule() {
    $('registrationDeadlineText')?.closest('.important-note')?.remove();
  }
  function render() {
    hideSchedule();
    const current = state();
    document.body.dataset.registrationClosed = current === 'CLOSED' ? 'true' : 'false';
    if (current === 'OPEN') {
      if (blocked) {
        const verify = $('verifyBtn');
        const ready = Boolean($('consent')?.checked && $('email')?.value.trim() && $('nickname')?.value.trim());
        if (verify) verify.disabled = !ready || verify.classList.contains('busy');
        const submit = $('submitBtn');
        if (submit) submit.disabled = submit.classList.contains('busy');
      }
      blocked = false;
      ['verifyMessage', 'submitMessage'].forEach((id) => {
        const el = $(id);
        if (el?.dataset.windowMessage !== undefined) {
          if (el.textContent === el.dataset.windowMessage) el.textContent = '';
          delete el.dataset.windowMessage;
        }
      });
      return;
    }
    blocked = true;
    const message = current === 'LOADING' ? '' : current === 'NOT_OPEN' ? copy().notOpen : current === 'CLOSED' ? copy().closed : copy().unavailable;
    ['verifyBtn', 'submitBtn'].forEach((id) => { if ($(id)) $(id).disabled = true; });
    ['verifyMessage', 'submitMessage'].forEach((id) => {
      const el = $(id);
      if (el) { el.textContent = message; el.dataset.windowMessage = message; }
    });
  }
  async function load() {
    if (loading) return;
    loading = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(API, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
      const value = await response.json();
      if (!response.ok || value.ok !== true) throw new Error('CONFIG_UNAVAILABLE');
      config = value;
      loadedAt = Date.now();
      loadFailed = false;
    } catch {
      loadFailed = true;
    } finally {
      clearTimeout(timeout);
      loading = false;
      render();
    }
  }
  document.addEventListener('click', (event) => {
    if (state() === 'OPEN') return;
    const button = event.target instanceof Element ? event.target.closest('#verifyBtn,#submitBtn') : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    render();
    if (!config || loadFailed) load();
  }, true);
  document.addEventListener('input', () => { if (state() !== 'OPEN') queueMicrotask(render); }, true);
  document.addEventListener('change', () => queueMicrotask(render), true);
  window.addEventListener('mc-language-change', render);
  window.addEventListener('focus', load);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  setInterval(load, 30000);
  setInterval(render, 1000);
  render();
  load();
})();
