export const PRIVACY_URL = "https://www.muniverse.io/privacy";
export const SUPPORT_EMAIL = "support@muniverse.io";

export type Territory = "kr" | "world";
export type Language = "ko" | "ja" | "en" | "zh-TW" | "zh-CN";
export type RoundPhase = "draft" | "scheduled" | "open" | "closed" | "paused" | "completed";
export type ClaimStatus = "open" | "closed" | "submitted" | "shipped";
export type Round = {
  id: string;
  title: string;
  announce_at: number | null;
  close_at: number | null;
  purge_at: number | null;
  territory: Territory | null;
  published_at: number | null;
  completed_at: number | null;
  kr_import: number;
  tw_express: number;
  paused_at: number | null;
  created_at: number;
};
export type RoundSummary = Round & { total: number; submitted: number; phase: RoundPhase };
export type LookupGroup = { id: string; name: string; announceAt: number; closeAt: number };
export type WinnerMatch = {
  round: string;
  prize: string;
  closeAt: number;
  purgeAt: number | null;
  territory: Territory;
  krImport: boolean;
  twExpress: boolean;
  status: ClaimStatus;
  token?: string;
};
export type AdminWinner = {
  id: string;
  account: string;
  nickname: string;
  prize: string;
  submittedAt: number | null;
  hasDelivery: boolean;
  hasPersonalData: boolean;
  contactEmail: string;
  xAccount: string;
};

const KR_OFFSET = 9 * 60 * 60 * 1000;

export function fromKstInput(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(value + ":00+09:00");
  return Number.isFinite(timestamp) && toKstInput(timestamp) === value ? timestamp : null;
}

export function toKstInput(value: number | null) {
  return value === null ? "" : new Date(value + KR_OFFSET).toISOString().slice(0, 16);
}

export function formatKst(value: number, language: Language = "ko") {
  const iso = toKstInput(value);
  if (language === "en") return iso.replace("T", " ") + " KST";
  return iso.slice(0, 10).replaceAll("-", ".") + " " + iso.slice(11) + " KST";
}

export function roundPhase(round: Round, now = Date.now()): RoundPhase {
  if (!round.published_at) return "draft";
  if (round.completed_at) return "completed";
  if (round.close_at! <= now) return "closed";
  if (round.paused_at) return "paused";
  if (round.announce_at! > now) return "scheduled";
  return "open";
}

export function claimStatus(submitted: number | null, shipped: number | null, closeAt: number, now: number): ClaimStatus {
  if (shipped) return "shipped";
  if (submitted) return "submitted";
  return closeAt <= now ? "closed" : "open";
}

export function receiptRef(winnerId: string) {
  return winnerId.replaceAll("-", "").slice(0, 12).toUpperCase();
}

export const countryCodes = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");

export const internationalMailNotice = "https://www.muniverse.io/notices/36";
export const taiwanShippingNotice = "https://www.muniverse.io/notices/35";

// Muniverse's suspension applies until its notice is superseded.
const suspendedDestinations = new Set("AE AM AO AZ BH CY DJ DZ ET FI GH GR IE IL IR JO KE KW LB MA MZ NG NO OM QA RS SA SC TN TZ ZM ZW KY BM".split(" "));

export function shippingFields(country: string, krImport: boolean) {
  return {
    domestic: country === "KR",
    postalRequired: ["KR", "JP", "TW"].includes(country),
    regionRequired: country === "JP" || country === "TW",
    koreanClearance: country === "KR" && krImport,
    taiwanEzWay: country === "TW",
    suspended: suspendedDestinations.has(country),
  };
}

export type Delivery = {
  recipient: string;
  phone: string;
  // Optional in stored records created before contact fields were introduced.
  contactEmail?: string;
  xAccount?: string;
  country: string;
  postal: string;
  region: string;
  city: string;
  address1: string;
  address2: string;
  clearanceCode?: string;
  ezWayConfirmed?: boolean;
};
