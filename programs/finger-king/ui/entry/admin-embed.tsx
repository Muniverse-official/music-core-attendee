import { createRoot, type Root } from "react-dom/client";
import { AdminDashboard } from "../dashboard";
import { setAdminSession } from "../finger-client";
import "../globals.css";
import "./admin-embed.css";

let root: Root | null = null;
let host: HTMLElement | null = null;

export function unmountFingerAdmin() {
  root?.unmount();
  root = null;
  setAdminSession("");
  host?.shadowRoot?.replaceChildren();
  host = null;
}

export function mountFingerAdmin(target: HTMLElement, token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("관리자 로그인이 필요합니다.");
  unmountFingerAdmin();
  host = target;
  const shadow = target.shadowRoot ?? target.attachShadow({ mode: "open" });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL("./admin-embed.css", import.meta.url).href;
  const mount = document.createElement("div");
  shadow.replaceChildren(stylesheet, mount);
  setAdminSession(token);
  root = createRoot(mount);
  root.render(<AdminDashboard embedded />);
}
