"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ClientError, fetchStatus, post } from "./finger-client";
import { countryCodes, formatKst, PRIVACY_URL, SUPPORT_EMAIL, internationalMailNotice, taiwanShippingNotice, shippingFields, type Language, type LookupGroup, type WinnerMatch } from "../../../supabase/functions/finger-king/finger";
import { shippingCopy, winnerCopy } from "./winner-copy";

type Release = { groups: LookupGroup[] };
type DeliveryPreview = { country: string; sample: WinnerMatch };

export function Brand() {
  return <a className="brand" href="/music-core-attendee/finger-king/">
    <img src="/music-core-attendee/finger-king/assets/muniverse-logo.svg" alt="Muniverse" width={163} height={26} />
  </a>;
}

function Field({ label, children, optional }: { label: string; children: ReactNode; optional?: string }) {
  return <label className="field"><span>{label}{optional && <small> ({optional})</small>}</span>{children}</label>;
}

export function WinnerPage({ admin, initialState, preview }: { admin: boolean; initialState: Release | null; preview?: DeliveryPreview }) {
  const [language, setLanguage] = useState<Language>("ko");
  const t = winnerCopy[language];
  const [groups, setGroups] = useState(initialState?.groups ?? null);
  const [groupId, setGroupId] = useState("");
  const [account, setAccount] = useState("");
  const [nickname, setNickname] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<WinnerMatch | null | undefined>(preview?.sample);
  const [view, setView] = useState<"lookup" | "delivery" | "done">(preview ? "delivery" : "lookup");
  const [error, setError] = useState("");
  const resultsAnchor = useRef<HTMLDivElement>(null);
  const selectedGroup = groups?.find((group) => group.id === groupId);

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = `${t.program} | ${t.title}`;
  }, [language, t.program, t.title]);

  useEffect(() => {
    if (view !== "lookup") resultsAnchor.current?.focus();
  }, [view]);

  useEffect(() => {
    if (view !== "lookup") return;
    const controller = new AbortController();
    async function refreshGroups() {
      if (document.hidden) return;
      try {
        const response = await fetchStatus(controller.signal);
        if (!response.ok) return;
        const state: Release = await response.json();
        if (!controller.signal.aborted) setGroups(state.groups);
      } catch {
        // Keep the current selection through transient request failures.
      }
    }
    void refreshGroups();
    const interval = window.setInterval(refreshGroups, 30_000);
    window.addEventListener("focus", refreshGroups);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshGroups);
    };
  }, [view]);

  useEffect(() => {
    if (!groupId || !groups || groups.some((group) => group.id === groupId)) return;
    setGroupId("");
    setResult(undefined);
  }, [groupId, groups]);

  useEffect(() => {
    const nextClose = groups?.reduce((next, group) => Math.min(next, group.closeAt), Infinity);
    if (nextClose === undefined || !Number.isFinite(nextClose)) return;
    const timer = window.setTimeout(() => {
      setGroups((current) => current?.filter((group) => group.closeAt > Date.now()) ?? null);
    }, Math.max(0, Math.min(nextClose - Date.now(), 2_147_483_647)));
    return () => window.clearTimeout(timer);
  }, [groups]);

  function clearResult() {
    setResult(undefined);
    setError("");
  }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupId || pending) return;
    clearResult();
    setPending(true);
    try {
      const data = await post<{ result: WinnerMatch | null }>("lookup", { groupId, account, nickname });
      setResult(data.result);
    } catch (err) {
      const code = err instanceof ClientError ? err.code : "service";
      setError(code);
      if (code === "group_unavailable") {
        const state = await fetchStatus()
          .then((response) => response.ok ? response.json() as Promise<Release> : null)
          .catch(() => null);
        if (state) {
          setGroups(state.groups);
          if (!state.groups.some((group) => group.id === groupId)) setGroupId("");
        }
      }
    } finally {
      setPending(false);
    }
  }

  return <div className="event-app">
    <header className="event-header">
      <div className="event-wrap header-inner">
        <Brand />
        <select className="language-switch" aria-label="언어 / Language" value={language}
          onChange={(event) => setLanguage(event.target.value as Language)}>
          <option value="ko" lang="ko">한국어</option>
          <option value="ja" lang="ja">日本語</option>
          <option value="en" lang="en">English</option>
          <option value="zh-TW" lang="zh-TW">繁體中文</option>
          <option value="zh-CN" lang="zh-CN">简体中文</option>
        </select>
      </div>
    </header>
    <main className="event-wrap event-main">
      <section className="hero" aria-labelledby="event-title">
        <div className="hero-grid" aria-hidden="true" />
        <img className="finger-logo" src="/music-core-attendee/finger-king/assets/finger-king-logo.png" alt={t.program} width="153" height="147" />
        <div className="hero-copy">
          <p className="hero-kicker">{t.prediction}</p>
          <h1 id="event-title">{t.title}</h1>
        </div>
        <img className="hero-trophy" src="/music-core-attendee/finger-king/assets/golden-finger.png" alt="" width="173" height="196" />
      </section>
      <section className="event-card lookup-card" aria-labelledby="lookup-title">
        {view === "done" ? <div className="success-pane" ref={resultsAnchor} tabIndex={-1}>
          <span className="success-mark" aria-hidden="true">✓</span>
          <h2 id="lookup-title">{t.sentTitle}</h2>
          <p>{t.sentText}</p>
          <button type="button" className="primary-button" onClick={() => setView("lookup")}>{t.done}</button>
        </div> : view === "delivery" && result ? <div ref={resultsAnchor} tabIndex={-1}>
          {preview ? <a className="text-button back-button" href="/music-core-attendee/finger-king/"><span aria-hidden="true">←</span> {t.lookup}</a> :
            <button type="button" className="text-button back-button" onClick={() => setView("lookup")}><span aria-hidden="true">←</span> {t.back}</button>}
          <h2 id="lookup-title">{t.delivery}</h2>
          <p className="card-intro">{t.deliveryHelp}</p>
          <div className="selected-prize"><span>{result.round}</span><strong>{result.prize}</strong>
            <small>{t.deadline} {formatKst(result.closeAt, language)}</small></div>
          {preview && <p className="status-line" role="note">{previewNotice[language]}</p>}
          <DeliveryForm winner={result} language={language} previewCountry={preview?.country} onSuccess={() => {
            setResult({ ...result, status: "submitted", token: undefined });
            setView("done");
          }} />
        </div> : <>
          <h2 id="lookup-title">{t.lookup}</h2>
          <p className="card-intro lookup-intro">{t.lookupHelp}</p>
          <div className="lookup-help">
            <p className="lookup-help-title">{t.accountHelp.title}</p>
            <p className="lookup-help-steps">
              <span>{t.accountHelp.signIn}</span>
              <span className="lookup-help-follow"><span className="lookup-help-arrow" aria-hidden="true">→</span><span>{t.accountHelp.myPage}</span></span>
            </p>
          </div>
          <form className="lookup-form" onSubmit={lookup}>
            <Field label={t.vote}>
              <select name="groupId" value={groupId} required disabled={pending || !groups?.length} onChange={(event) => {
                setGroupId(event.target.value);
                clearResult();
              }}>
                <option value="">{t.chooseVote}</option>
                {groups?.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            </Field>
            {!error && groups?.length === 0 && <p className="status-line">{t.pending}</p>}
            {!error && groups === null && <p className="status-line" role="status">{t.errors.service}</p>}
            {!error && selectedGroup && selectedGroup.announceAt > Date.now() && <p className="status-line">
              {t.scheduled} {formatKst(selectedGroup.announceAt, language)}
            </p>}
            <div className="form-grid">
              <Field label={t.account}><input name="account" type="email" value={account} placeholder={t.accountPlaceholder} required maxLength={254} autoComplete="email"
                autoCapitalize="none" spellCheck={false} disabled={pending} onChange={(event) => { setAccount(event.target.value); clearResult(); }} /></Field>
              <Field label={t.nickname}><input name="nickname" value={nickname} required maxLength={100}
                autoComplete="off" disabled={pending} onChange={(event) => { setNickname(event.target.value); clearResult(); }} /></Field>
            </div>
            <button className="primary-button" type="submit" disabled={pending || !groupId}>{pending ? t.checking : t.check}<span aria-hidden="true">→</span></button>
          </form>
          <div aria-live="polite" aria-atomic="true">
            {error && <p className="form-error" role="alert">{t.errors[error as keyof typeof t.errors] ?? t.errors.service}</p>}
            {result === null && <div className="lookup-result empty-result">{t.empty}</div>}
            {result && <div className="lookup-result">
              <div className="result-header"><strong>{result.round}</strong><span className={"status-chip " + result.status}>{t.statuses[result.status]}</span></div>
              <p>{result.prize}</p>
              {result.status === "open" && <>
                <small>{t.deadline} {formatKst(result.closeAt, language)}</small>
                <button type="button" className="secondary-button" onClick={() => setView("delivery")}>{t.openForm} <span aria-hidden="true">→</span></button>
              </>}
            </div>}
          </div>
        </>}
      </section>
    </main>
    <footer className="event-footer event-wrap">
      <nav aria-label={t.footer}>
        <a href={PRIVACY_URL} target="_blank" rel="noreferrer">{t.privacyLink}</a>
        <a href={"mailto:" + SUPPORT_EMAIL}>{t.support}</a>
        {admin && <a href="/admin">{t.admin}</a>}
      </nav>
    </footer>
  </div>;
}

const previewNotice: Record<Language, string> = {
  ko: "검수용 화면입니다. 입력한 정보는 전송되거나 저장되지 않습니다.",
  en: "Test preview. Nothing you enter is sent or saved.",
  ja: "確認用の画面です。入力内容は送信・保存されません。",
  "zh-TW": "此為測試預覽。輸入的資料不會傳送或儲存。",
  "zh-CN": "此为测试预览。输入的信息不会发送或保存。",
};

function DeliveryForm({ winner, language, onSuccess, previewCountry }: {
  winner: WinnerMatch; language: Language; onSuccess: () => void; previewCountry?: string;
}) {
  const t = winnerCopy[language];
  const [country, setCountry] = useState(previewCountry ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const names = useMemo(() => {
    const name = new Intl.DisplayNames([language], { type: "region" });
    return countryCodes.map((code) => ({ code, label: name.of(code) ?? code })).sort((a, b) => a.label.localeCompare(b.label, language));
  }, [language]);
  const copy = shippingCopy[language];
  const fields = shippingFields(country, winner.krImport);
  const postalPattern = fields.domestic ? "[0-9]{5}" : country === "JP" ? "[0-9]{3}-?[0-9]{4}" : undefined;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (previewCountry || fields.suspended) return;
    const form = new FormData(event.currentTarget);
    setError("");
    setPending(true);
    try {
      await post("submit", { ...Object.fromEntries(form.entries()), token: winner.token, consent: form.has("consent") });
      onSuccess();
    } catch (err) {
      setError(err instanceof ClientError ? err.code : "service");
    } finally {
      setPending(false);
    }
  }

  return <form method="post" onSubmit={submit} className="delivery-form">
    <Field label={t.country}>
        <select name="country" value={country} onChange={(event) => { setCountry(event.target.value); setError(""); }} required autoComplete="shipping country">
          <option value="">{t.chooseCountry}</option>{names.map(({ code, label }) => <option key={code} value={code}>{label}</option>)}
        </select>
      </Field>
    {fields.suspended && <p className="form-error" role="alert">{copy.suspended} <a href={internationalMailNotice} target="_blank" rel="noreferrer">{copy.notice} ↗</a></p>}
    {country && !fields.suspended && <div className="delivery-form" key={country}>
      <p className="field-hint">{fields.domestic ? copy.domestic : copy.international}</p>
      <div className="form-grid">
        <Field label={t.recipient}><input name="recipient" maxLength={100} required autoComplete="shipping name" /></Field>
        <Field label={t.phone}><input name="phone" type="tel" placeholder={fields.domestic ? "010-0000-0000" : "+00 0000 0000"} maxLength={38} required autoComplete="shipping tel" /></Field>
      </div>
      {!fields.domestic && <div className="form-grid">
        <Field label={country === "JP" ? copy.prefecture : country === "TW" ? copy.county : t.region} optional={fields.regionRequired ? undefined : t.optional}>
          <input name="region" maxLength={110} required={fields.regionRequired} autoComplete="shipping address-level1" />
        </Field>
        <Field label={country === "TW" ? copy.district : t.city}><input name="city" maxLength={110} required autoComplete="shipping address-level2" /></Field>
      </div>}
      <Field label={t.postal} optional={fields.postalRequired ? undefined : t.optional}>
        <input name="postal" maxLength={fields.domestic ? 5 : country === "JP" ? 8 : 22} placeholder={country === "JP" ? "123-4567" : undefined}
          inputMode={fields.domestic ? "numeric" : "text"} pattern={postalPattern} required={fields.postalRequired} autoComplete="shipping postal-code" />
      </Field>
      <Field label={t.address1}><input name="address1" maxLength={200} placeholder={fields.domestic ? t.koreanAddress : t.worldAddress} required autoComplete="shipping address-line1" /></Field>
      <Field label={t.address2} optional={t.optional}><input name="address2" maxLength={160} placeholder={fields.domestic ? t.koreanDetail : t.worldDetail} autoComplete="shipping address-line2" /></Field>
      {fields.koreanClearance && <Field label={copy.clearance}>
        <input name="clearanceCode" placeholder="P123456789012" maxLength={13} pattern="[Pp][0-9]{12}" required autoComplete="off"
          autoCapitalize="characters" spellCheck={false} aria-describedby="clearance-help" />
      </Field>}
      {fields.koreanClearance && <p className="field-hint" id="clearance-help">{copy.clearanceHelp}</p>}
      {country === "TW" && <p className="field-hint">{copy.ezWayHelp} <a href={taiwanShippingNotice} target="_blank" rel="noreferrer">EZ WAY ↗</a></p>}
      {fields.taiwanEzWay && <label className="checkbox-row"><input type="checkbox" name="ezWay" required /><span>{copy.ezWay}</span></label>}
    </div>}
    <section className="privacy-notice" aria-labelledby="privacy-title">
      <h3 id="privacy-title">{t.privacy}</h3>
      <dl><dt>{t.purpose}</dt><dd>{t.purposeText}{fields.koreanClearance || fields.taiwanEzWay ? " · " + copy.purpose : ""}</dd><dt>{t.items}</dt><dd>{t.itemsText}{fields.koreanClearance ? ", " + copy.clearance : ""}{fields.taiwanEzWay ? ", " + copy.ezWayItem : ""}</dd>
        <dt>{t.retention}</dt><dd>{winner.purgeAt ? formatKst(winner.purgeAt, language) : copy.retention}</dd></dl>
      <p>{t.decline}</p>
    </section>
    <label className="checkbox-row"><input type="checkbox" key={country} name="consent" required /><span>{t.agree}</span></label>
    <button className="primary-button" type="submit" disabled={Boolean(previewCountry) || pending || !country || fields.suspended}>{pending ? t.sending : t.send}<span aria-hidden="true">→</span></button>
    {error && <p className="form-error" role="alert">{error === "shipping_unavailable" ? copy.suspended : error === "customs" ? copy.customsError : t.errors[error as keyof typeof t.errors] ?? t.errors.service}</p>}
  </form>;
}
