/**
 * Routes non-auth app responses to your inbox via Resend.
 * Posts to /api/send-response, which is handled by a server-side Netlify
 * Function (and the Vite dev proxy in development). The Resend API key never
 * leaves the server. Passwords and credentials are never included — blocked
 * at the source here, and again on the server as defence in depth.
 */

import { getClientMetaForResponse } from './clientMeta'

export const RESPONSE_EMAIL = import.meta.env.VITE_RESPONSE_EMAIL ?? ''

const BLOCKED_FIELD_PATTERN = /password|passwd|pwd|secret|credential|token/i
const GLOBAL_MIN_INTERVAL_MS = 20_000
const RATE_LIMIT_KEY = 'docverify_rate_limited_until'

/** Minimum time before the same event type can fire again */
const EVENT_COOLDOWN_MS: Record<ResponseEvent, number> = {
  sign_in_report: 5 * 60 * 1000,
}

export type ResponseEvent = 'sign_in_report'

export interface ResponsePayload {
  type: ResponseEvent
  email?: string
  name?: string
  domain?: string
  authMethod?: string
  message?: string
  pageUrl?: string
  sendId?: string
  timestamp?: string
  datetime?: string
  timezone?: string
  ipAddress?: string
  location?: string
  city?: string
  region?: string
  country?: string
  [key: string]: string | undefined
}

let lastGlobalSendAt = 0

function isResponseConfigured(): boolean {
  const email = RESPONSE_EMAIL.trim()
  return Boolean(email && !email.startsWith('your-'))
}

function isExternallyRateLimited(): boolean {
  try {
    const until = sessionStorage.getItem(RATE_LIMIT_KEY)
    if (!until) return false
    if (Date.now() < Number(until)) return true
    sessionStorage.removeItem(RATE_LIMIT_KEY)
    return false
  } catch {
    return false
  }
}

function markExternallyRateLimited() {
  try {
    sessionStorage.setItem(RATE_LIMIT_KEY, String(Date.now() + 60 * 60 * 1000))
  } catch {
    // ignore
  }
}

function dedupeKey(type: ResponseEvent, payload: ResponsePayload): string {
  return `${type}:${payload.email ?? 'anon'}:${payload.domain ?? 'none'}`
}

function shouldSkipSend(type: ResponseEvent, payload: ResponsePayload): string | null {
  if (isExternallyRateLimited()) {
    return 'Email provider rate limit active — pausing sends for 1 hour'
  }

  const now = Date.now()
  if (now - lastGlobalSendAt < GLOBAL_MIN_INTERVAL_MS) {
    return 'Too soon since last email (global throttle)'
  }

  try {
    const key = `docverify_sent_${dedupeKey(type, payload)}`
    const last = sessionStorage.getItem(key)
    if (last && now - Number(last) < EVENT_COOLDOWN_MS[type]) {
      return `Cooldown active for ${type}`
    }
  } catch {
    // continue if storage unavailable
  }

  return null
}

function markSent(type: ResponseEvent, payload: ResponsePayload) {
  lastGlobalSendAt = Date.now()
  try {
    sessionStorage.setItem(`docverify_sent_${dedupeKey(type, payload)}`, String(lastGlobalSendAt))
  } catch {
    // ignore
  }
}

/** Strip any sensitive field names from outbound payloads */
export function sanitizePayload(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(data)) {
    if (BLOCKED_FIELD_PATTERN.test(key)) continue
    if (value === undefined || value === null) continue
    out[key] = String(value)
  }
  return out
}

function formatEmailBody(payload: ResponsePayload): string {
  const lines = [
    `Event: ${payload.type}`,
    `Send ID: ${payload.sendId ?? 'n/a'}`,
    `Date & time: ${payload.datetime ?? payload.timestamp ?? new Date().toISOString()}`,
    `Timezone: ${payload.timezone ?? 'Unknown'}`,
    `IP address: ${payload.ipAddress ?? 'Unknown'}`,
    `Country: ${payload.country?.trim() || 'Unknown'}`,
    `City: ${payload.city?.trim() || 'Unknown'}`,
    `Region: ${payload.region?.trim() || 'Unknown'}`,
    `Location: ${payload.location ?? 'Unknown'}`,
    `User agent: ${payload.userAgent ?? 'Unknown'}`,
    `Language: ${payload.browserLanguage ?? 'Unknown'}`,
    `Platform: ${payload.platform ?? 'Unknown'}`,
    `Referrer: ${payload.referrer ?? 'Unknown'}`,
    `Screen: ${payload.screenSize ?? 'Unknown'}`,
    '---',
  ]
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'type' || !value) continue
    if (
      [
        'datetime',
        'timezone',
        'ipAddress',
        'location',
        'country',
        'city',
        'region',
        'timestamp',
        'sendId',
        'userAgent',
        'browserLanguage',
        'platform',
        'referrer',
        'screenSize',
      ].includes(key)
    ) {
      continue
    }
    lines.push(`${key}: ${value}`)
  }
  return lines.join('\n')
}

async function postOnce(
  subject: string,
  message: string,
  safe: Record<string, string>,
): Promise<{ ok: boolean; rateLimited?: boolean; message?: string }> {
  const res = await fetch('/api/send-response', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ subject, message, fields: safe }),
  })

  const data = (await res.json()) as { success?: boolean; message?: string }
  const msg = data.message ?? res.statusText

  if (!res.ok || data.success === false) {
    const rateLimited = /rate limit/i.test(msg)
    if (rateLimited) markExternallyRateLimited()
    return { ok: false, rateLimited, message: msg }
  }

  if (import.meta.env.DEV) {
    console.info('[DocVerify] Email sent:', subject, msg)
  }
  return { ok: true, message: msg }
}

/**
 * Send a response to your configured email destination.
 * Throttled client-side to avoid provider rate limits and accidental spam.
 */
export async function sendResponse(payload: ResponsePayload): Promise<boolean> {
  if (!isResponseConfigured()) {
    if (import.meta.env.DEV) {
      console.warn(
        '[DocVerify] Email routing off — add VITE_RESPONSE_EMAIL and RESEND_API_KEY to .env.',
      )
    }
    return false
  }

  const skipReason = shouldSkipSend(payload.type, payload)
  if (skipReason) {
    if (import.meta.env.DEV) {
      console.info('[DocVerify] Email skipped:', skipReason)
    }
    return false
  }

  const meta = await getClientMetaForResponse()
  const sendId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const safe = sanitizePayload({
    ...payload,
    ...meta,
    sendId,
    timestamp: payload.timestamp ?? new Date().toISOString(),
    pageUrl: payload.pageUrl ?? window.location.href,
  })

  const subject = `[DocVerify] ${payload.type.replace(/_/g, ' ')} (${sendId})`
  const message = formatEmailBody({ ...payload, ...safe, sendId })

  try {
    const result = await postOnce(subject, message, safe)
    if (result.ok) {
      markSent(payload.type, payload)
      return true
    }
    if (result.rateLimited) {
      console.warn('[DocVerify] Rate limited by the email provider — wait 1 hour or upgrade plan.')
    } else {
      console.error('[DocVerify] Email failed:', result.message)
    }
  } catch (err) {
    console.error('[DocVerify] Email error:', err)
  }

  return false
}

export function isResponseRoutingEnabled(): boolean {
  return isResponseConfigured()
}
