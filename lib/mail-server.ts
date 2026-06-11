export const RESEND_ENDPOINT = 'https://api.resend.com/emails'
export const MAX_SUBJECT_LEN = 200
export const MAX_MESSAGE_LEN = 20_000
export const MAX_BATCH_SIZE = 5
export const SENSITIVE_FIELD_PATTERN = /secret|credential|token|api[_-]?key/i
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function sanitizeFields(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) continue
    if (value === undefined || value === null || value === '') continue
    out[key] = String(value)
  }
  return out
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function resolveMailConfig(): {
  apiKey: string
  to: string
  from: string
  configured: boolean
  configError?: string
} {
  const apiKey = process.env.RESEND_API_KEY ?? ''
  const to = (process.env.RESPONSE_EMAIL ?? process.env.VITE_RESPONSE_EMAIL ?? '')
    .trim()
    .toLowerCase()
  const from = (process.env.RESEND_FROM ?? 'DocVerify <onboarding@resend.dev>').trim()

  if (!apiKey || apiKey.startsWith('your-')) {
    return { apiKey, to, from, configured: false, configError: 'RESEND_API_KEY not configured' }
  }
  if (!to || to.startsWith('your-')) {
    return { apiKey, to, from, configured: false, configError: 'Destination email not configured' }
  }

  return { apiKey, to, from, configured: true }
}

export async function sendResendEmail(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  message: string,
  fields: Record<string, string>,
): Promise<{ ok: boolean; id?: string; message?: string }> {
  const replyTo =
    fields.email && EMAIL_PATTERN.test(fields.email) ? fields.email : undefined

  const html = `<pre style="font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${escapeHtml(
    message,
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
        subject,
        text: message,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    })
  } catch (err) {
    const reason = `Failed to reach Resend: ${(err as Error).message}`
    console.error('[DocVerify Mail]', { status: 'error', reason, subject })
    return { ok: false, message: reason }
  }

  const rawBody = await upstream.text()
  let data: { id?: string; message?: string } = {}
  try {
    data = JSON.parse(rawBody) as typeof data
  } catch {
    // surfaced below
  }

  if (upstream.ok && data.id) {
    console.info('[DocVerify Mail]', {
      status: 'sent',
      to,
      subject,
      resendId: data.id,
      visitorEmail: fields.email,
    })
    return { ok: true, id: data.id }
  }

  const failureMessage =
    data.message?.trim() ||
    upstream.statusText?.trim() ||
    `Resend ${upstream.status}: ${rawBody.slice(0, 300)}`

  console.error('[DocVerify Mail]', {
    status: 'failed',
    to,
    subject,
    visitorEmail: fields.email,
    reason: failureMessage,
  })

  return { ok: false, message: failureMessage }
}
