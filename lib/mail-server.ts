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

  const formattedMessage = escapeHtml(message).replace(/\n/g, '<br />')
  const html = `
    <div style="background:#f3f4f6;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.08);">
        <div style="background:linear-gradient(135deg,#f8fafc,#eef2ff);padding:24px 28px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;font-weight:700;margin-bottom:8px;">DocVerify</div>
          <h1 style="margin:0;color:#111827;font-size:28px;line-height:1.25;font-weight:700;">Security report</h1>
        </div>
        <div style="padding:24px 28px 28px;background:#f9fafb;">
          <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:12px;padding:18px 20px;color:#1f2937;font-size:15px;line-height:1.7;white-space:normal;">
            ${formattedMessage}
          </div>
        </div>
      </div>
    </div>
  `

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
