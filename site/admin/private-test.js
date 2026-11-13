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
  <div class="actions"><button id="enhypenTestOpen" type="button">당첨 발표 페이지 열기</button><button id="enhypenTestPause" class="secondary" type="button">발표 공개</button></div>
  <p id="enhypenTestMessage" role="status" class="message"></p>
  <nav class="tabs" aria-label="엔하이픈 당첨 구분"><button type="button" data-enhypen-kind="primary" aria-pressed="true">본 당첨 <span id="enhypenPrimaryCount">0</span>/50</button><button type="button" data-enhypen-kind="reserve" aria-pressed="false">예비 당첨 <span id="enhypenReserveCount">0</span>/30</button><button type="button" data-enhypen-kind="withdrawn" aria-pressed="false">방청 취소</button></nav>
  <form id="enhypenImport"><label>당첨자 명단 붙여넣기<textarea id="enhypenRows" rows="5" required></textarea></label><p id="enhypenFormat" class="muted small"></p><button type="submit">명단 추가</button></form>
  <div class="section-head"><h2 id="enhypenListTitle">본 당첨자 명단</h2><div class="actions"><button id="enhypenCsv" class="secondary" type="button">이 목록 CSV</button><button id="enhypenWeverseCsv" class="secondary" type="button">위버스 제공용 CSV</button></div></div>
  <div class="filters"><input id="enhypenSearch" type="search" aria-label="이메일·닉네임·번호 검색" placeholder="이메일·닉네임·번호 검색"><select id="enhypenFilter" aria-label="정보 등록 상태"><option value="all">전체 상태</option><option value="agreed">등록 완료</option><option value="pending">미등록</option></select><span id="enhypenVisible" class="muted" aria-live="polite"></span></div>
  <div class="table-wrap" tabindex="0" aria-label="엔하이픈 당첨자 명단"><table><thead><tr><th>가입 이메일</th><th>닉네임</th><th>개인 당첨 번호</th><th>정보 등록 상태</th><th>이름</th><th>생년월일</th><th>국적</th><th>연락처</th><th>번호 구분</th><th>안내용 이메일</th><th>X 계정</th><th>관리</th></tr></thead><tbody id="enhypenTable"></tbody></table></div>
  <p id="enhypenEmpty" class="empty">등록된 명단이 없습니다.</p>
  <dialog id="enhypenNumber" aria-labelledby="enhypenNumberTitle"><form id="enhypenNumberForm"><h2 id="enhypenNumberTitle"></h2><p id="enhypenNumberName"></p><label>개인 당첨 번호<input id="enhypenNumberValue" type="text" inputmode="numeric" pattern="[0-9]{1,16}" maxlength="16" required></label><label id="enhypenDeadlineWrap" hidden>정보 입력 기한 (한국시간)<input id="enhypenDeadline" type="datetime-local"></label><p class="muted small">다른 당첨자와 중복되지 않는 숫자를 입력하세요.</p><p id="enhypenNumberMessage" role="status" class="message"></p><div class="actions"><button id="enhypenNumberCancel" class="secondary" type="button">취소</button><button type="submit">저장</button></div></form></dialog>`;
  dashboard.insertBefore(panel, settings);
  const message = document.getElementById('enhypenTestMessage');
  const pause = document.getElementById('enhypenTestPause');
  const open = document.getElementById('enhypenTestOpen');
  const refresh = document.getElementById('enhypenTestRefresh');
  const get = id => document.getElementById(id);
  const input = get('enhypenRows');
  const dialog = get('enhypenNumber');
  const numberInput = get('enhypenNumberValue');
  const kindButtons = [...panel.querySelectorAll('[data-enhypen-kind]')];
  let kind = 'primary';
  let editing;
  let active = false;
  let state;
  let operation = 0;
  let loading = false;
  let expiryTimer;
  const errors = {CAPACITY:'본 당첨 50명 또는 예비 당첨 30명 한도에 도달했습니다. 예비 당첨자를 전환하려면 먼저 본 당첨 자리를 확보해 주세요.', DUPLICATE_NUMBER:'이미 부여된 당첨 번호입니다.', DUPLICATE_WINNER:'이미 등록된 이메일·닉네임 조합이 있습니다.', INVALID_FIELDS:'이메일과 닉네임 형식을 확인해 주세요.', INVALID_NUMBER:'당첨 번호는 숫자 1~16자리로 입력하세요.', INVALID_DEADLINE:'정보 입력 기한을 현재 시각 이후, 11월 25일 이내로 지정해 주세요.', INVALID_TRANSITION:'현재 상태에서는 변경할 수 없습니다. 명단을 새로고침해 주세요.', NO_PRIMARY:'본 당첨자를 추가한 뒤 공개할 수 있습니다.', WINNER_MISSING:'명단에 없는 당첨자입니다.'};

  function setLoading(value) {
    loading = value;
    pause.disabled = loading || !state;
    refresh.disabled = loading;
    open.disabled = loading || !state;
    get('enhypenImport').querySelector('button').disabled = loading || !state;
    get('enhypenNumberForm').querySelectorAll('button').forEach(button => { button.disabled = loading; });
    panel.querySelectorAll('#enhypenTable button').forEach(button => { button.disabled = loading; });
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
    if (!result.ok || !data.ok) throw new Error(errors[data.code] || `명단을 불러오거나 저장하지 못했습니다. (${data.code || result.status})`);
    return data;
  }

  function render(next) {
    state = next;
    pause.textContent = state.open ? '발표 닫기' : '발표 공개';
    get('enhypenTestStatus').textContent = state.open ? '공개 중' : '미공개';
    get('enhypenPrimaryCount').textContent = state.winners.filter(row => row.selection === 'primary').length;
    get('enhypenReserveCount').textContent = state.winners.filter(row => row.selection === 'reserve').length;
    renderList();
  }

  function visibleRows() {
    const query = get('enhypenSearch').value.trim().toLowerCase();
    const status = get('enhypenFilter').value;
    return state.winners.filter(row => row.selection === kind && [row.email,row.nickname,row.winner_number].some(value => value?.toLowerCase().includes(query)) && (kind !== 'primary' || status === 'all' || (status === 'agreed') === Boolean(row.consent)));
  }

  function registrationValues(row) {
    const c = row.consent;
    if (!c) return ['','','','','','',''];
    return [c.legal_name,c.birth_date,c.nationality,c.phone,c.phone_mode === 'KR' ? '한국 번호' : '해외 번호',c.contact_email,c.x_account];
  }

  function renderList() {
    const rows = visibleRows();
    get('enhypenListTitle').textContent = {primary:'본 당첨자 명단',reserve:'예비 당첨자 명단',withdrawn:'방청 취소 명단'}[kind];
    get('enhypenFilter').hidden = kind !== 'primary';
    get('enhypenVisible').textContent = `${rows.length}명`;
    get('enhypenCsv').disabled = !rows.length;
    get('enhypenWeverseCsv').hidden = kind !== 'primary';
    get('enhypenWeverseCsv').disabled = !state.winners.some(row => row.selection === 'primary' && row.consent);
    kindButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.enhypenKind === kind)));
    get('enhypenImport').hidden = kind === 'withdrawn';
    get('enhypenFormat').textContent = kind === 'primary' ? '한 줄에 이메일, 닉네임, 번호를 입력하세요. 엑셀에서 세 열을 복사해 붙여넣을 수도 있습니다.' : '한 줄에 이메일, 닉네임을 입력하세요. 개인 번호는 본 당첨 전환 시 지정합니다.';
    input.placeholder = kind === 'primary' ? 'fan@example.com, 닉네임, 001' : 'fan@example.com, 닉네임';
    get('enhypenEmpty').hidden = Boolean(rows.length);
    get('enhypenTable').replaceChildren(...rows.map(row => {
      const tr = document.createElement('tr');
      for (const value of [row.email, row.nickname, row.winner_number, row.consent ? '등록 완료' : '미등록', ...registrationValues(row)]) {
        const td = document.createElement('td');
        td.textContent = value || '—';
        tr.append(td);
      }
      const actions = document.createElement('td');
      const add = (label, handler) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent = label;
        button.onclick = handler;
        actions.append(button);
      };
      if (kind === 'primary') {
        add('번호 수정', () => editNumber(row, 'number'));
        add('방청 취소', () => { if (confirm(`${row.nickname} 님의 방청을 취소할까요?`)) void run({action:'withdraw', id:row.id}); });
      }
      if (kind === 'reserve') add('본 당첨 전환', () => editNumber(row, 'promote'));
      if (!state.open) add('삭제', () => { if (confirm(`${row.nickname} 님을 명단에서 삭제할까요?`)) void run({action:'remove', id:row.id}); });
      tr.append(actions);
      return tr;
    }));
  }

  function editNumber(row, action) {
    editing = {action, id:row.id};
    get('enhypenNumberTitle').textContent = action === 'promote' ? '본 당첨 전환 및 번호 지정' : '개인 당첨 번호 수정';
    get('enhypenNumberName').textContent = row.nickname;
    numberInput.value = row.winner_number || '';
    const deadline = get('enhypenDeadline');
    get('enhypenDeadlineWrap').hidden = action !== 'promote';
    deadline.required = action === 'promote';
    deadline.value = new Date(Date.parse(row.consent_deadline || '2026-11-20T15:00:00+09:00') + 9*3600000).toISOString().slice(0,16);
    get('enhypenNumberMessage').textContent = '';
    dialog.showModal();
  }

  function parseList(text) {
    const required = kind === 'primary' ? 3 : 2;
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (/^"?(이메일|email)"?\s*[,\t]/i.test(lines[0] || '')) lines.shift();
    return lines.map((line, i) => {
      const columns = line.includes('\t') ? line.split('\t') : (line.match(/(?:"(?:[^"]|"")*"|[^,]*)(?:,|$)/g) || []).filter(Boolean).map(value => value.replace(/,$/, ''));
      const [email,nickname,number] = columns.map(value => value.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"'));
      if (columns.length !== required || !email || !nickname || (required === 3 && !/^\d{1,16}$/.test(number || ''))) throw new Error(`${i + 1}번째 줄의 이메일·닉네임${required === 3 ? '·번호' : ''}를 확인해 주세요.`);
      return {email,nickname,number};
    });
  }

  async function run(body, success) {
    if (loading || !active) return;
    const id = ++operation;
    const token = getToken();
    setLoading(true);
    const feedback = dialog.open ? get('enhypenNumberMessage') : message;
    feedback.textContent = '처리 중…';
    try {
      if (body.action !== 'state') await request(body);
      const data = await request({action:'state'});
      if (!active || id !== operation || token !== getToken()) return;
      render(data);
      success?.();
      feedback.textContent = '';
    } catch (error) {
      if (id === operation && active) {
        feedback.textContent = error.message;
      }
    } finally {
      if (id === operation) setLoading(false);
    }
  }

  function leave() {
    ++operation;
    active = false;
    state = undefined;
    input.value = '';
    get('enhypenSearch').value = '';
    get('enhypenFilter').value = 'all';
    get('enhypenTable').replaceChildren();
    if (dialog.open) dialog.close();
    editing = undefined;
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
  pause.onclick = () => {
    if (!state.open && !confirm('발표를 공개할까요? 링크를 아는 당첨자는 지금부터 결과를 확인할 수 있습니다.')) return;
    void run({action:'visibility', open:!state.open});
  };
  refresh.onclick = () => run({action:'state'});
  open.onclick = () => { location.assign('../private-test/'); };
  kindButtons.forEach(button => { button.onclick = () => {
    if (!state || loading || kind === button.dataset.enhypenKind) return;
    if (input.value.trim() && !confirm('저장하지 않은 명단을 지우고 이동할까요?')) return;
    input.value = '';
    kind = button.dataset.enhypenKind;
    renderList();
  }; });
  get('enhypenImport').onsubmit = event => {
    event.preventDefault();
    try {
      const rows = parseList(input.value);
      if (!rows.length) throw new Error('추가할 당첨자를 입력해 주세요.');
      void run({action:'import', selection:kind, rows}, () => { input.value = ''; });
    } catch (error) { message.textContent = error.message; }
  };
  get('enhypenNumberCancel').onclick = () => dialog.close();
  dialog.addEventListener('cancel', event => { if (loading) event.preventDefault(); });
  get('enhypenNumberForm').onsubmit = event => {
    event.preventDefault();
    if (!editing) return;
    const deadline = editing.action === 'promote' ? `${get('enhypenDeadline').value}:00+09:00` : undefined;
    void run({...editing, number:numberInput.value, deadline}, () => dialog.close());
  };
  for (const id of ['enhypenSearch','enhypenFilter']) get(id).oninput = () => { if (state) renderList(); };
  function download(rows, filename) {
    const cell = value => {
      const safe = String(value ?? '');
      return '"' + (/^[\s]*[=+@-]/.test(safe) ? "'" + safe : safe).replaceAll('"','""') + '"';
    };
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a'); anchor.href=url; anchor.download=filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  get('enhypenCsv').onclick = () => download([['가입 이메일','닉네임','개인 당첨 번호','정보 등록 상태','이름','생년월일','국적','연락처','번호 구분','방청 안내용 이메일','X 계정'],...visibleRows().map(row => [row.email,row.nickname,row.winner_number,row.consent?'등록 완료':'미등록',...registrationValues(row)])],`enhypen-${kind}.csv`);
  get('enhypenWeverseCsv').onclick = () => download([['이름','연락처','개인 당첨 번호'],...state.winners.filter(row => row.selection === 'primary' && row.consent).map(row => [row.consent.legal_name,row.consent.phone,row.winner_number])],'enhypen-weverse.csv');

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
