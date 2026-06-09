/**
 * DocVerify transactional email sender (production).
 *
 * Delivers notification emails through Resend's official REST API.
 *   - The Resend API key lives ONLY in this server-side function
 *     (Netlify env var RESEND_API_KEY). It is never sent to the browser.
 *   - The frontend posts { subject, message, fields } and never sees a secret.
 *   - Inputs are validated and sensitive field names are stripped as a
 *     second line of defence before anything is sent.
 *
 * Resend docs: https://resend.com/docs/api-reference/emails/send-email
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

const MAX_SUBJECT_LEN = 200
const MAX_MESSAGE_LEN = 20_000

// Best-effort, in-memory abuse guard. Netlify scales/recycles instances, so this
// only throttles bursts hitting the same warm instance — the frontend enforces
// the primary cooldown/dedup. It is a cheap extra barrier, not the only one.
const IP_MIN_INTERVAL_MS = 5_000
const lastSendByIp = new Map<string, number>()

const SENSITIVE_FIELD_PATTERN = /password|passwd|pwd|secret|credential|token|api[_-]?key/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')
  return (fwd?.split(',')[0] ?? '').trim() || 'unknown'
}

/** Remove sensitive keys, drop empty values, coerce everything to strings. */
function sanitizeFields(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) continue
    if (value === undefined || value === null || value === '') continue
    out[key] = String(value)
  }
  return out
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  // --- Basic anti-abuse: per-IP throttle on the warm instance ---
  const ip = clientIp(req)
  const now = Date.now()
  const last = lastSendByIp.get(ip) ?? 0
  if (now - last < IP_MIN_INTERVAL_MS) {
    return json(429, { success: false, message: 'Too many requests — slow down.' })
  }

  // --- Parse + validate input ---
  let body: { subject?: unknown; message?: unknown; fields?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json(400, { success: false, message: 'Invalid JSON' })
  }

  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  const rawFields =
    body.fields && typeof body.fields === 'object'
      ? (body.fields as Record<string, unknown>)
      : {}

  if (!subject || !message) {
    return json(400, { success: false, message: 'Missing subject or message' })
  }
  if (subject.length > MAX_SUBJECT_LEN || message.length > MAX_MESSAGE_LEN) {
    return json(413, { success: false, message: 'Subject or message too long' })
  }

  const fields = sanitizeFields(rawFields)

  // --- Resolve server-only configuration ---
  const apiKey = process.env.RESEND_API_KEY ?? ''
  if (!apiKey || apiKey.startsWith('your-')) {
    console.error('[DocVerify Mail]', {
      status: 'not_configured',
      reason: 'RESEND_API_KEY not configured',
      subject,
    })
    return json(500, { success: false, message: 'RESEND_API_KEY not configured' })
  }

  // Recipient (inbox that receives notifications). Not a secret; falls back to
  // the VITE_-prefixed value the frontend already uses for its "configured" check.
  const to = (process.env.RESPONSE_EMAIL ?? process.env.VITE_RESPONSE_EMAIL ?? '')
    .trim()
    .toLowerCase()
  if (!to || to.startsWith('your-')) {
    console.error('[DocVerify Mail]', {
      status: 'not_configured',
      reason: 'Destination email not configured',
      subject,
    })
    return json(500, { success: false, message: 'Destination email not configured' })
  }

  // Verified sender. Until your domain is verified in Resend, use the shared
  // sandbox sender 'onboarding@resend.dev' (only delivers to your own account).
  const from = (process.env.RESEND_FROM ?? 'DocVerify <onboarding@resend.dev>').trim()

  // Let replies go to the visitor's address when one was supplied & looks valid.
  const replyTo =
    fields.email && EMAIL_PATTERN.test(fields.email) ? fields.email : undefined

  const html = `<pre style="font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${escapeHtml(
    message,
  )}</pre>`

  // --- Send via Resend's official REST API ---
  let upstream: Response
  try {
    upstream = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text: message,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    })
  } catch (err) {
    const reason = `Failed to reach Resend: ${(err as Error).message}`
    console.error('[DocVerify Mail]', {
      status: 'error',
      to,
      from,
      subject,
      replyTo,
      visitorEmail: fields.email,
      reason,
    })
    return json(502, {
      success: false,
      message: reason,
    })
  }

  const rawBody = await upstream.text()
  let data: { id?: string; message?: string; name?: string } = {}
  try {
    data = JSON.parse(rawBody) as typeof data
  } catch {
    // Non-JSON response — surface the raw text in the error path below.
  }

  if (upstream.ok && data.id) {
    lastSendByIp.set(ip, now)
    console.info('[DocVerify Mail]', {
      status: 'sent',
      to,
      from,
      subject,
      resendId: data.id,
      replyTo,
      visitorEmail: fields.email,
    })
    return json(200, { success: true, id: data.id })
  }

  const failureMessage =
    data.message ??
    `Resend ${upstream.status} ${upstream.statusText}: ${rawBody.slice(0, 300)}`

  console.error('[DocVerify Mail]', {
    status: 'failed',
    to,
    from,
    subject,
    replyTo,
    visitorEmail: fields.email,
    reason: failureMessage,
  })

  return json(upstream.status === 0 ? 502 : upstream.status || 400, {
    success: false,
    message: failureMessage,
  })
}
