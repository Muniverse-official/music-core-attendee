"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Brand } from "./winner-page";
import { ClientError, csvDownload, parseRoster, post } from "./finger-client";
import { formatKst, receiptRef, toKstInput, type AdminWinner, type RoundPhase, type RoundSummary } from "../../../supabase/functions/finger-king/finger";

type Tab = "settings" | "winners" | "shipping";
const phaseText: Record<RoundPhase, string> = { draft: "준비 중", scheduled: "발표 예약", open: "접수 중", closed: "입력 마감", paused: "일시 중지", completed: "발표 종료" };
const tabs: { key: Tab; label: string }[] = [
  { key: "winners", label: "당첨자 명단" },
  { key: "settings", label: "발표·접수 설정" },
  { key: "shipping", label: "배송 관리" },
];
const errors: Record<string, string> = {
  forbidden: "운영 관리 권한이 없습니다. 승인된 계정의 로그인 상태를 확인해 주세요.",
  input: "입력한 값을 확인해 주세요.",
  size: "파일이 너무 큽니다. 명단을 나눠서 등록해 주세요.",
  service: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
};

function errorText(error: unknown) {
  return error instanceof ClientError ? error.detail ?? errors[error.code] ?? errors.service : errors.service;
}

export function AdminDashboard() {
  const [rounds, setRounds] = useState<RoundSummary[] | null>(null);
  const [activeId, setActiveId] = useState("");
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>("winners");
  const [roster, setRoster] = useState<{ groupId: string; winners: AdminWinner[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const active = rounds?.find((round) => round.id === activeId);
  const isCreating = creating || (rounds?.length === 0);
  const winners = roster?.groupId === activeId ? roster.winners : null;

  async function loadRounds(nextId?: string) {
    const data = await post<{ rounds: RoundSummary[] }>("admin-rounds");
    setRounds(data.rounds);
    setActiveId((current) => nextId ?? (data.rounds.some((round) => round.id === current) ? current : data.rounds[0]?.id ?? ""));
  }

  async function loadWinners(id: string) {
    const data = await post<{ winners: AdminWinner[] }>("admin-winners", { id });
    setRoster({ groupId: id, winners: data.winners });
  }

  useEffect(() => { void loadRounds().catch((err) => setError(errorText(err))); }, []);

  useEffect(() => {
    if (!activeId || creating || tab === "settings") return;
    let ignore = false;
    setRoster(null);
    void post<{ winners: AdminWinner[] }>("admin-winners", { id: activeId }).then((data) => {
      if (!ignore) setRoster({ groupId: activeId, winners: data.winners });
    }).catch((err) => { if (!ignore) setError(errorText(err)); });
    return () => { ignore = true; };
  }, [activeId, creating, tab]);

  async function work(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try { await action(); return true; }
    catch (err) { setError(errorText(err)); return false; }
    finally { setBusy(false); }
  }

  function choose(id: string) {
    setCreating(false);
    setActiveId(id);
    setTab("winners");
    setConfirmPublish(false);
    setError("");
    setNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget).entries());
    await work(async () => {
      const data = await post<{ id: string }>("admin-save", { ...form, id: isCreating ? undefined : activeId });
      await loadRounds(data.id);
      setCreating(false);
      if (isCreating) setTab("winners");
      setNotice(isCreating ? "투표명을 등록했습니다. 당첨자 명단을 등록해 주세요." : "발표·접수 설정을 저장했습니다.");
    });
  }

  async function changeRelease(mode: "publish" | "pause" | "resume" | "complete") {
    if (mode === "complete" && !window.confirm("이 투표의 발표를 종료할까요? 조회와 배송지 입력이 종료됩니다.")) return;
    await work(async () => {
      await post(mode === "publish" ? "admin-publish" : mode === "complete" ? "admin-complete" : "admin-pause", { id: activeId, paused: mode === "pause" });
      await loadRounds(activeId);
      setConfirmPublish(false);
      setNotice({ publish: "설정하신 시각에 당첨자 조회가 시작됩니다.", pause: "이 투표의 당첨자 조회와 배송지 접수를 중지했습니다.", resume: "이 투표의 당첨자 조회를 다시 열었습니다.", complete: "발표를 종료했습니다." }[mode]);
    });
  }

  async function importRoster(raw: string) {
    return work(async () => {
      const rows = parseRoster(raw);
      const data = await post<{ inserted: number; skipped: number }>("admin-import", { id: activeId, rows });
      await Promise.all([loadRounds(activeId), loadWinners(activeId)]);
      setNotice(`${data.inserted}명 등록 완료${data.skipped ? ` · 중복 ${data.skipped}명 제외` : ""}`);
    });
  }

  async function download(kind: "all" | "waiting") {
    await work(async () => {
      const data = await post<{ csv: string }>("admin-export", { id: activeId, waiting: kind === "waiting" });
      const roundName = (active?.title ?? "아이돌 핑거왕").replace(/[\\/:*?"<>|]/g, "_");
      csvDownload(roundName + (kind === "waiting" ? "_발송대기.csv" : "_배송지전체.csv"), data.csv);
      setNotice("CSV 다운로드를 시작했습니다.");
    });
  }

  async function remove(winner: AdminWinner) {
    if (!window.confirm(`${winner.nickname} 님을 당첨자 명단에서 삭제하시겠습니까?`)) return;
    await work(async () => {
      await post("admin-remove", { id: winner.id });
      await Promise.all([loadRounds(activeId), loadWinners(activeId)]);
      setNotice("명단에서 삭제했습니다.");
    });
  }

  async function markShipped(winner: AdminWinner) {
    await work(async () => {
      await post("admin-ship", { id: winner.id, shipped: !winner.shippedAt });
      await Promise.all([loadRounds(activeId), loadWinners(activeId)]);
      setNotice(winner.shippedAt ? "발송 대기 상태로 변경했습니다." : "발송 완료 상태로 변경했습니다.");
    });
  }

  async function markDelivered(winner: AdminWinner) {
    if (!window.confirm("경품 배송이 완료되었나요? 당첨자와 배송 개인정보가 파기됩니다.")) return;
    await work(async () => {
      await post("admin-delivered", { id: winner.id });
      await loadWinners(activeId);
      setNotice("배송 완료로 처리하고 개인정보를 파기했습니다.");
    });
  }

  return <div className="admin-app">
    <header className="admin-top"><div className="admin-top-wrap">
      <div className="admin-top-brand"><Brand /><span>아이돌 핑거왕 운영 관리</span></div>
      <a href="/music-core-attendee/finger-king/" className="admin-preview">당첨자 페이지 ↗</a>
    </div></header>
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="sidebar-title"><h2>투표 목록</h2><button className="admin-strong add-round" type="button" disabled={busy} onClick={() => {
          setCreating(true); setConfirmPublish(false); setError(""); setNotice("");
        }}>＋ 투표명 추가</button></div>
        <nav aria-label="이벤트 투표 목록">
          {rounds?.map((round) => <button className={"round-item" + (!creating && activeId === round.id ? " current" : "")}
            aria-current={!creating && activeId === round.id ? "true" : undefined}
            key={round.id} type="button" disabled={busy} onClick={() => choose(round.id)}>
            <span>{round.title}</span><small>{phaseText[round.phase]}</small>
          </button>)}
        </nav>
        {Boolean(rounds?.length) && <select className="mobile-vote-select" aria-label="관리할 투표"
          value={creating ? "" : activeId} disabled={busy} onChange={(event) => choose(event.target.value)}>
          <option value="" disabled>투표 선택</option>
          {rounds?.map((round) => <option key={round.id} value={round.id}>{round.title}</option>)}
        </select>}
        {rounds?.length === 0 && <p className="quiet-copy">등록된 투표가 없습니다.</p>}
      </aside>
      <main className="admin-main">
        <div aria-live="polite">
          {error && <div className="admin-message error" role="alert">{error} {!rounds && <button onClick={() => void work(loadRounds)} className="admin-quiet">다시 시도</button>}</div>}
          {notice && <div className="admin-message">{notice}</div>}
        </div>
        {!rounds && !error && <div className="admin-panel">투표 목록을 불러오는 중입니다…</div>}
        {isCreating ? <>
          <h1>투표명 추가</h1>
          <div className="admin-panel">
            <RoundForm key="new" save={save} busy={busy} />
          </div>
        </> : active && <>
          <div className="admin-page-title">
            <h1>{active.title}</h1><span className={"admin-phase " + active.phase}>{phaseText[active.phase]}</span>
          </div>
          <div className="admin-metrics">
            {[
              ["당첨자", active.total],
              ["미접수", active.total - active.submitted],
              ["배송지 접수", active.submitted],
              ["발송 완료", active.shipped],
            ].map(([label, value]) => <div className="metric" key={label}><span>{label}</span><strong>{Number(value).toLocaleString("ko-KR")}<small>명</small></strong></div>)}
          </div>
          <nav className="admin-tabs" aria-label="투표 관리">
            {tabs.map(({ key, label }) => <button type="button" key={key} aria-current={key === tab ? "page" : undefined}
              className={key === tab ? "active" : ""} disabled={busy} onClick={() => { setTab(key); setError(""); setNotice(""); }}>{label}</button>)}
          </nav>
          {tab === "settings" && <div className="admin-panel">
            <h2>발표·접수 설정</h2>
            {active.published_at ? <>
              <dl className="admin-settings">
                <dt>당첨 발표 시각</dt><dd>{formatKst(active.announce_at!)}</dd>
                <dt>배송지 입력 마감</dt><dd>{formatKst(active.close_at!)}</dd>



              </dl>
              {active.phase !== "completed" && active.phase !== "closed" && <>
                <button className="admin-outline" type="button" disabled={busy} onClick={() => void changeRelease(active.paused_at ? "resume" : "pause")}>{active.paused_at ? "조회·접수 다시 열기" : "조회·접수 일시 중지"}</button>
                <button className="admin-outline" type="button" disabled={busy} onClick={() => void changeRelease("complete")}>발표 종료</button>
              </>}
            </> : <>
              <RoundForm key={active.id + active.title + active.announce_at + active.close_at}
                round={active} save={save} busy={busy} />
              <div className="publish-box">
                <div><strong>당첨 발표 시작 또는 예약</strong><p>저장된 발표·접수 일정을 확인해 주세요. 발표 설정 후 일정과 명단이 확정됩니다.</p></div>
                <button type="button" className="admin-strong" disabled={busy} onClick={() => setConfirmPublish(!confirmPublish)}>{confirmPublish ? "돌아가기" : "발표 설정"}</button>
              </div>
              {confirmPublish && <div className="publish-review">
                <p>등록된 당첨자 {active.total}명 · {active.announce_at ? formatKst(active.announce_at) : "발표 시각 미설정"}</p>
                <button type="button" className="admin-strong" disabled={busy} onClick={() => void changeRelease("publish")}>이대로 발표 설정</button>
              </div>}
            </>}
          </div>}
          {tab === "winners" && <>
            {!active.published_at && <RosterImport key={active.id} busy={busy} onImport={importRoster} onError={setError} />}
            <section className="admin-panel">
              <div className="section-heading"><div><h2>당첨자 명단</h2><p>등록된 당첨자와 배송지 접수 상태를 확인할 수 있습니다.</p></div>
              </div>
              <WinnerTable winners={winners} canRemove={!active.published_at} busy={busy} onRemove={remove} />
            </section>
          </>}
          {tab === "shipping" && <section className="admin-panel">
            <div className="section-heading"><div><h2>경품 배송 관리</h2><p>배송지 접수 현황을 확인하고 경품 발송 후 완료 처리해 주세요.</p></div></div>
            <div className="download-row">
              <button className="admin-strong" type="button" disabled={busy || !winners?.some((row) => row.hasDelivery && !row.shippedAt)} onClick={() => void download("waiting")}>발송 대기 CSV ↓</button>
              <button className="admin-outline" type="button" disabled={busy || !winners?.some((row) => row.hasDelivery)} onClick={() => void download("all")}>배송지 전체 CSV ↓</button>
            </div>
            <WinnerTable shipping winners={winners?.filter((row) => row.submittedAt) ?? null} busy={busy} onShip={markShipped} onDelivered={markDelivered} />
          </section>}
        </>}
      </main>
    </div>
  </div>;
}

function RoundForm({ round, save, busy }: { round?: RoundSummary; save: (event: FormEvent<HTMLFormElement>) => void; busy: boolean }) {
  return <form className="admin-form" onSubmit={save}>
    <label><span>투표명</span><input name="title" required maxLength={100} defaultValue={round?.title} placeholder="예: 골든 핑거 예측 투표 EP.3 TREASURE" /></label>
    {round && <div className="settings-grid">
      <label><span>당첨 발표 시각 <small>KST</small></span><input name="announce" type="datetime-local" defaultValue={toKstInput(round?.announce_at ?? null)} /></label>
      <label><span>배송지 입력 마감 <small>KST</small></span><input name="close" type="datetime-local" defaultValue={toKstInput(round?.close_at ?? null)} /></label>

    </div>}
    <button className="admin-strong" disabled={busy}>{round ? "설정 저장" : "투표명 등록"}</button>
  </form>;
}

function RosterImport({ busy, onImport, onError }: { busy: boolean; onImport: (raw: string) => Promise<boolean>; onError: (error: string) => void }) {
  const [raw, setRaw] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  async function readFile(file?: File) {
    if (!file) return;
    if (file.size > 192_000) return onError(errors.size);
    setFileBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      try { setRaw(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
      catch { setRaw(new TextDecoder("euc-kr").decode(buffer)); }
      onError("");
    } catch {
      onError("파일을 읽을 수 없습니다. CSV 형식으로 다시 저장해 주세요.");
    } finally {
      setFileBusy(false);
    }
  }

  return <section className="admin-panel">
    <div className="section-heading"><div><h2>당첨자 등록</h2><p>뮤니버스 가입 이메일·닉네임·경품명 순서로 CSV를 올리거나 스프레드시트의 세 열을 붙여넣어 주세요.</p></div>
      <button className="admin-quiet" type="button" onClick={() => csvDownload("idol-finger-king-winner-template.csv", "\ufeff뮤니버스 가입 이메일,닉네임,경품명\r\n")}>CSV 양식 ↓</button>
    </div>
    <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void onImport(raw).then((ok) => { if (ok) setRaw(""); }); }}>
      <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" aria-label="당첨자 CSV 파일" disabled={busy || fileBusy}
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void readFile(file); }} />
      <label><span>등록할 명단</span><textarea value={raw} onChange={(event) => setRaw(event.target.value)} rows={4}
        placeholder={"뮤니버스 가입 이메일,닉네임,경품명"} required spellCheck={false} /></label>
      <button type="submit" className="admin-strong" disabled={busy || fileBusy || !raw.trim()}>당첨자 등록</button>
    </form>
  </section>;
}

function WinnerTable({ winners, shipping, canRemove, busy, onRemove, onShip, onDelivered }: {
  winners: AdminWinner[] | null; shipping?: boolean; canRemove?: boolean; busy: boolean;
  onRemove?: (winner: AdminWinner) => void; onShip?: (winner: AdminWinner) => void; onDelivered?: (winner: AdminWinner) => void;
}) {
  if (!winners) return <p className="table-empty">명단을 불러오는 중입니다…</p>;
  if (!winners.length) return <p className="table-empty">{shipping ? "접수된 배송지가 없습니다." : "등록된 당첨자가 없습니다."}</p>;
  return <div className="table-frame" tabIndex={0}><table className="winner-table">
    <thead><tr>{shipping && <th scope="col">접수번호</th>}<th scope="col">뮤니버스 가입 이메일</th><th scope="col">닉네임</th><th scope="col">경품명</th><th scope="col">상태</th>
      {shipping && <th scope="col">접수 시각</th>}{(shipping || canRemove) && <th scope="col">관리</th>}</tr></thead>
    <tbody>{winners.map((winner) => <tr key={winner.id}>
      {shipping && <td>{receiptRef(winner.id)}</td>}<td>{winner.account || "파기됨"}</td><td>{winner.nickname || "—"}</td><td>{winner.prize}</td>
      <td><span className={"row-status" + (winner.shippedAt ? " shipped" : winner.submittedAt ? " received" : "")}>
        {winner.shippedAt ? (winner.hasDelivery ? "발송 완료" : "발송 완료 · 개인정보 파기") : winner.submittedAt ? (winner.hasDelivery ? "배송지 접수" : "보유 기한 만료") : "미접수"}</span></td>
      {shipping && <td>{winner.submittedAt && formatKst(winner.submittedAt)}</td>}
      {shipping && <td><button className="admin-quiet" disabled={busy || !winner.hasDelivery} onClick={() => onShip?.(winner)}>
        {winner.shippedAt ? "발송 대기로 변경" : "발송 완료 처리"}</button>{winner.shippedAt && winner.hasDelivery && <button type="button" className="admin-quiet" disabled={busy} onClick={() => onDelivered?.(winner)}>배송 완료 · 개인정보 파기</button>}</td>}
      {canRemove && <td><button className="admin-quiet remove" disabled={busy} onClick={() => onRemove?.(winner)}>삭제</button></td>}
    </tr>)}</tbody>
  </table></div>;
}
