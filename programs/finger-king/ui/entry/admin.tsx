import { createRoot } from "react-dom/client";
import { AdminDashboard } from "../dashboard";
import { setAdminSession } from "../finger-client";
import "../globals.css";
import "./embedded.css";

const root = createRoot(document.querySelector("#fingerApp")!);
const origin = "https://muniverse-official.github.io";

if (window === window.parent) {
  root.render(<p className="admin-access"><a href="/music-core-attendee/admin/">통합관리자에서 아이돌 핑거왕 탭을 열어 주세요.</a></p>);
} else {
  window.addEventListener("message", (event) => {
    if (event.origin !== origin || event.source !== window.parent) return;
    if (event.data?.type !== "finger-admin-session" || !/^[0-9a-f]{64}$/.test(event.data?.token ?? "")) return;
    setAdminSession(event.data.token);
    root.render(<AdminDashboard />);
  }, { passive: true });
  const observer = new ResizeObserver(([entry]) => {
    window.parent.postMessage({ type: "finger-admin-height", height: Math.ceil(entry.contentRect.height) }, origin);
  });
  observer.observe(document.querySelector("#fingerApp")!);
  window.parent.postMessage({ type: "finger-admin-ready" }, origin);
}
