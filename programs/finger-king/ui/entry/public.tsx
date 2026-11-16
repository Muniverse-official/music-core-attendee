import { createRoot } from "react-dom/client";
import { countryCodes, type WinnerMatch } from "../../../../supabase/functions/finger-king/finger";
import { WinnerPage } from "../winner-page";
import "../globals.css";

const query = new URLSearchParams(location.search);
const country = query.get("country") ?? "KR";
const day = 86_400_000;
const sample: WinnerMatch = {
  round: "아이돌 핑거왕 검수용 투표",
  prize: "경품 샘플",
  closeAt: Date.now() + 7 * day,
  purgeAt: null,
  territory: "world",
  krImport: query.get("import") === "1",
  twExpress: true,
  status: "open",
};
const preview = query.get("preview") === "delivery" ? { sample, country: countryCodes.includes(country) ? country : "KR" } : undefined;
createRoot(document.querySelector("#fingerApp")!).render(<WinnerPage admin={false} initialState={null} preview={preview} />);
