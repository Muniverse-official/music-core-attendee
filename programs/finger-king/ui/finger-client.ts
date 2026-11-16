const endpoint = "https://kkaoerbblpuszptiibvo.supabase.co/functions/v1/finger-king";
let adminSession = "";

export function setAdminSession(token: string) {
  adminSession = token;
}

export function fetchStatus(signal?: AbortSignal) {
  return fetch(endpoint + "?action=status", { cache: "no-store", credentials: "omit", signal });
}

export class ClientError extends Error {
  constructor(public code: string, public detail?: string) {
    super(detail ?? code);
  }
}

export async function post<T>(action: string, value: object = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (action.startsWith("admin-") && adminSession) headers.Authorization = "Bearer " + adminSession;
  const response = await fetch(endpoint + "?action=" + encodeURIComponent(action), {
    method: "POST", headers, body: JSON.stringify(value),
    cache: "no-store", credentials: "omit",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const failure = result as { error?: string; detail?: string } | null;
    throw new ClientError(failure?.error ?? "service", failure?.detail);
  }
  return result as T;
}

export function csvDownload(file: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseRoster(raw: string): string[][] {
  const text = raw.replace(/^\ufeff/, "");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.includes("\t") ? "\t" : ",";
  const result: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let closed = false;
  const finishField = () => { row.push(value.trim()); value = ""; closed = false; };
  const finishLine = () => { finishField(); if (row.some(Boolean)) result.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') value += char;
      else if (text[i + 1] === '"') { value += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (char === delimiter) {
      finishField();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishLine();
    } else if (char === '"' && !value.trim() && !closed) {
      value = "";
      quoted = true;
    } else if (!closed) {
      value += char;
    } else if (char !== " ") {
      throw new ClientError("rows", "CSV의 따옴표와 열 구분을 확인해 주세요.");
    }
  }
  if (quoted) throw new ClientError("rows", "CSV의 닫는 따옴표가 빠졌습니다.");
  finishLine();
  const headers = result[0]?.map((part) => part.replaceAll(" ", "").toLowerCase());
  if (headers?.length === 3 && ["뮤니버스가입이메일", "가입이메일", "이메일", "email", "muniverseemail", "아이디", "id", "account", "accountid"].includes(headers[0]) &&
    ["닉네임", "nickname"].includes(headers[1]) && ["경품", "경품명", "prize"].includes(headers[2])) result.shift();
  return result;
}
