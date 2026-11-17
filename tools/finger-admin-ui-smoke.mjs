import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Every request is intercepted. No production session or data is used.
const base = path.resolve(import.meta.dirname, '..');
const host = 'https://muniverse-official.github.io';
const api = 'https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/finger-king';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const calls = [], errors = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', route => route.abort());
await context.route(host + '/music-core-attendee/**', async route => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/finger-admin-local-qa.html')) {
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}iframe{width:100%;height:1600px;border:0}</style></head><body><iframe src="/music-core-attendee/finger-king/admin.html"></iframe><script>window.addEventListener('message',event=>{if(event.data?.type==='finger-admin-ready')event.source.postMessage({type:'finger-admin-session',token:'${'a'.repeat(64)}'},'${host}')})</script></body></html>` });
  }
  const relative = url.pathname.replace('/music-core-attendee/', '');
  const file = path.resolve(base, 'site', relative);
  if (!file.startsWith(path.join(base, 'site') + path.sep)) return route.abort();
  try {
    const body = await readFile(file);
    return route.fulfill({ body, contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
  } catch { return route.fulfill({ status: 404 }); }
});
const round = { id: '11111111-1111-4111-8111-111111111111', title: '핑거왕 개인정보 관리 검수', phase: 'open', total: 3, submitted: 2,
  announce_at: Date.now() - 60000, close_at: Date.now() + 3600000, published_at: Date.now() - 60000, created_at: Date.now() - 120000, purge_at: null };
const winners = ['삭제 테스트', '보존 테스트', '미제출 테스트'].map((nickname, index) => ({
  id: `${index + 2}2222222-2222-4222-8222-222222222222`, nickname, account: `qa${index}@example.invalid`, prize: '경품 샘플',
  submittedAt: index < 2 ? Date.now() - 30000 : null, hasDelivery: index < 2, hasPersonalData: true,
  contactEmail: index < 2 ? `contact${index}@example.invalid` : '', xAccount: index < 2 ? `@qa_${index}` : '',
}));
await context.route(api + '?**', async route => {
  const request = route.request();
  const headers = { 'access-control-allow-origin': host, 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'POST,OPTIONS' };
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  assert.equal(request.headers().authorization, 'Bearer ' + 'a'.repeat(64));
  const action = new URL(request.url()).searchParams.get('action'), body = request.postDataJSON();
  calls.push({ action, body });
  let response;
  if (action === 'admin-rounds') response = { rounds: [round] };
  else if (action === 'admin-winners') response = { winners };
  else if (action === 'admin-export') response = { csv: '\ufeff접수번호,연락 가능한 이메일\r\nQA,contact0@example.invalid\r\n' };
  else if (action === 'admin-delete-personal-data') {
    assert.equal(body.confirm, true);
    const winner = winners.find(winner => winner.id === body.id);
    assert(winner);
    Object.assign(winner, { account: '', nickname: '', contactEmail: '', xAccount: '', hasDelivery: false, hasPersonalData: false });
    response = { id: body.id };
  } else throw new Error('Unexpected action: ' + action);
  return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(response) });
});
const page = await context.newPage();
await mkdir(path.join(base, 'qa-screenshots'), { recursive: true });
try {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(host + '/music-core-attendee/finger-admin-local-qa.html');
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: '개인정보 삭제', exact: true }).first().waitFor();
  assert.equal(await frame.getByRole('button', { name: /배송 관리|발송|배송 완료/ }).count(), 0);
  assert.equal(await frame.locator('.admin-tabs button').count(), 2);
  assert.equal(await frame.getByRole('button', { name: '개인정보 삭제', exact: true }).count(), 3);
  assert.equal(await frame.locator('.metric').count(), 3);
  assert.equal(await frame.getByRole('button', { name: '제출 정보 CSV ↓' }).isEnabled(), true);
  await page.screenshot({ path: path.join(base, 'qa-screenshots/finger-admin-simple-desktop.png'), fullPage: true });
  const first = frame.locator('tbody tr').filter({ hasText: '삭제 테스트' });
  let message = '';
  page.once('dialog', async dialog => { message = dialog.message(); await dialog.dismiss(); });
  await first.getByRole('button', { name: '개인정보 삭제', exact: true }).click();
  assert.match(message, /삭제 테스트/);
  assert.match(message, /복구할 수 없습니다/);
  assert.equal(calls.filter(call => call.action === 'admin-delete-personal-data').length, 0);
  page.once('dialog', dialog => dialog.accept());
  await first.getByRole('button', { name: '개인정보 삭제', exact: true }).click();
  await frame.getByText('선택한 당첨자의 개인정보를 삭제했습니다.', { exact: true }).waitFor();
  assert.deepEqual(calls.filter(call => call.action === 'admin-delete-personal-data'), [{ action: 'admin-delete-personal-data', body: { id: winners[0].id, confirm: true } }]);
  assert.equal(await frame.getByText('개인정보 삭제됨', { exact: true }).count(), 1);
  assert.equal(await frame.getByText('보존 테스트', { exact: true }).count(), 1);
  assert.equal(await frame.getByRole('button', { name: '개인정보 삭제', exact: true }).first().isEnabled(), false);
  assert.equal(await frame.locator('tbody tr').filter({ hasText: '미제출 테스트' }).getByRole('button', { name: '개인정보 삭제', exact: true }).isEnabled(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  const child = page.frames().find(frame => frame.url().endsWith('/finger-king/admin.html'));
  assert(child);
  assert.equal(await child.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await child.locator('.table-frame').evaluate(element => element.scrollWidth > element.clientWidth), true);
  assert.equal(await child.locator('.winner-table').evaluate(element => element.getBoundingClientRect().width >= 1120), true);
  await page.screenshot({ path: path.join(base, 'qa-screenshots/finger-admin-simple-mobile.png'), fullPage: true });
  const mobileDelete = frame.locator('tbody tr').filter({ hasText: '미제출 테스트' }).getByRole('button', { name: '개인정보 삭제', exact: true });
  await mobileDelete.scrollIntoViewIfNeeded();
  assert.equal(await mobileDelete.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth;
  }), true);
  await page.screenshot({ path: path.join(base, 'qa-screenshots/finger-admin-simple-mobile-actions.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS simplified admin, no shipping controls, CSV retained, cancel/confirm scoped deletion, deleted state and mobile layout');
} finally { await browser.close(); }
