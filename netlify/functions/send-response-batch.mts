/**
 * Sends multiple DocVerify notification emails in one request.
 * All items are dispatched in parallel so sign-in attempt 1–3 arrive together.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

const MAX_BATCH_SIZE = 5
const MAX_SUBJECT_LEN = 200
const MAX_MESSAGE_LEN = 20_000

const SENSITIVE_FIELD_PATTERN = /secret|credential|token|api[_-]?key/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface BatchItem {
  subject: string
  message: string
  fields: Record<string, string>
}

function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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

async function sendOne(
  apiKey: string,
  from: string,
  to: string,
  item: BatchItem,
): Promise<{ ok: boolean; id?: string; message?: string }> {
  const replyTo =
    item.fields.email && EMAIL_PATTERN.test(item.fields.email)
      ? item.fields.email
      : undefined

  const html = `<pre style="font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${escapeHtml(
    item.message,
  )}</pre>`

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
        subject: item.subject,
        text: item.message,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    })
  } catch (err) {
    return { ok: false, message: `Failed to reach Resend: ${(err as Error).message}` }
  }

  const rawBody = await upstream.text()
  let data: { id?: string; message?: string } = {}
  try {
    data = JSON.parse(rawBody) as typeof data
  } catch {
    // non-JSON
  }

  if (upstream.ok && data.id) {
    console.info('[DocVerify Mail]', {
      status: 'sent',
      to,
      from,
      subject: item.subject,
      resendId: data.id,
      replyTo,
      visitorEmail: item.fields.email,
      attempt: item.fields.attempt,
      outcome: item.fields.outcome,
    })
    return { ok: true, id: data.id }
  }

  const failureMessage =
    data.message ??
    `Resend ${upstream.status} ${upstream.statusText}: ${rawBody.slice(0, 300)}`

  console.error('[DocVerify Mail]', {
    status: 'failed',
    to,
    from,
    subject: item.subject,
    replyTo,
    visitorEmail: item.fields.email,
    reason: failureMessage,
  })

  return { ok: false, message: failureMessage }
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  let body: { items?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return json(400, { success: false, message: 'Invalid JSON' })
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return json(400, { success: false, message: 'Missing items array' })
  }

  if (body.items.length > MAX_BATCH_SIZE) {
    return json(413, { success: false, message: `Batch too large (max ${MAX_BATCH_SIZE})` })
  }

  const items: BatchItem[] = []
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object') {
      return json(400, { success: false, message: 'Invalid batch item' })
    }
    const entry = raw as Record<string, unknown>
    const subject = typeof entry.subject === 'string' ? entry.subject.trim() : ''
    const message = typeof entry.message === 'string' ? entry.message.trim() : ''
    const rawFields =
      entry.fields && typeof entry.fields === 'object'
        ? (entry.fields as Record<string, unknown>)
        : {}

    if (!subject || !message) {
      return json(400, { success: false, message: 'Each item needs subject and message' })
    }
    if (subject.length > MAX_SUBJECT_LEN || message.length > MAX_MESSAGE_LEN) {
      return json(413, { success: false, message: 'Subject or message too long' })
    }

    items.push({
      subject,
      message,
      fields: sanitizeFields(rawFields),
    })
  }

  const apiKey = process.env.RESEND_API_KEY ?? ''
  if (!apiKey || apiKey.startsWith('your-')) {
    return json(500, { success: false, message: 'RESEND_API_KEY not configured' })
  }

  const to = (process.env.RESPONSE_EMAIL ?? process.env.VITE_RESPONSE_EMAIL ?? '')
    .trim()
    .toLowerCase()
  if (!to || to.startsWith('your-')) {
    return json(500, { success: false, message: 'Destination email not configured' })
  }

  const from = (process.env.RESEND_FROM ?? 'DocVerify <onboarding@resend.dev>').trim()

  const results = await Promise.all(items.map((item) => sendOne(apiKey, from, to, item)))
  const ids = results.map((r) => r.id).filter((id): id is string => Boolean(id))

  if (ids.length === items.length) {
    return json(200, { success: true, ids, count: ids.length })
  }

  const firstError = results.find((r) => !r.ok)?.message ?? 'One or more emails failed'
  return json(502, {
    success: false,
    message: firstError,
    ids,
    sent: ids.length,
    total: items.length,
  })
}
