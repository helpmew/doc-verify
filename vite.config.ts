import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage } from 'http'

const root = path.dirname(fileURLToPath(import.meta.url))

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function jsonResponse(res: import('http').ServerResponse, status: number, body: object) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// Allow password through to the notification email; still strip API keys/tokens.
const SENSITIVE_FIELD_PATTERN = /secret|credential|token|api[_-]?key/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function sendResendEmail(
  resendApiKey: string,
  resendFrom: string,
  responseEmail: string,
  subject: string,
  message: string,
  fields: Record<string, string>,
): Promise<{ ok: boolean; id?: string; message?: string }> {
  const replyTo =
    fields.email && EMAIL_PATTERN.test(fields.email) ? fields.email : undefined
  const html = `<pre style="font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap">${escapeHtml(
    message,
  )}</pre>`

  const upstream = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resendFrom,
      to: [responseEmail],
      subject,
      text: message,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  })

  const data = (await upstream.json().catch(() => ({}))) as {
    id?: string
    message?: string
  }

  if (upstream.ok && data.id) {
    console.info('[DocVerify Mail]', {
      status: 'sent',
      to: responseEmail,
      from: resendFrom,
      subject,
      resendId: data.id,
      replyTo,
      visitorEmail: fields.email,
      attempt: fields.attempt,
      outcome: fields.outcome,
    })
    return { ok: true, id: data.id }
  }

  const failureMessage =
    data.message?.trim() ||
    upstream.statusText?.trim() ||
    `Resend HTTP ${upstream.status} rejected the send`
  console.error('[DocVerify Mail]', {
    status: 'failed',
    to: responseEmail,
    from: resendFrom,
    subject,
    replyTo,
    visitorEmail: fields.email,
    httpStatus: upstream.status,
    reason: failureMessage,
  })
  return { ok: false, message: failureMessage }
}

function apiPlugin(env: Record<string, string>): Plugin {
  const recaptchaSecret = env.RECAPTCHA_SECRET_KEY ?? ''
  const resendApiKey = env.RESEND_API_KEY ?? ''
  const resendFrom = env.RESEND_FROM ?? 'DocVerify <onboarding@resend.dev>'
  const responseEmail = (env.RESPONSE_EMAIL ?? env.VITE_RESPONSE_EMAIL ?? '')
    .trim()
    .toLowerCase()

  return {
    name: 'docverify-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/') || req.method !== 'POST') {
          next()
          return
        }

        try {
          const raw = await readBody(req)
          const body = JSON.parse(raw) as Record<string, unknown>

          if (req.url === '/api/verify-captcha') {
            const token = body.token as string | undefined
            if (!token) {
              jsonResponse(res, 400, { success: false, message: 'Missing captcha token' })
              return
            }
            if (token === 'demo-captcha-verified') {
              jsonResponse(res, 200, { success: true })
              return
            }
            if (!recaptchaSecret) {
              jsonResponse(res, 500, { success: false, message: 'RECAPTCHA_SECRET_KEY not configured' })
              return
            }
            const params = new URLSearchParams()
            params.append('secret', recaptchaSecret)
            params.append('response', token)
            const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: params.toString(),
            })
            const result = (await verifyRes.json()) as { success?: boolean; 'error-codes'?: string[] }
            if (result.success) {
              jsonResponse(res, 200, { success: true })
            } else {
              jsonResponse(res, 400, {
                success: false,
                message: result['error-codes']?.join(', ') ?? 'Captcha verification failed',
              })
            }
            return
          }

          if (req.url === '/api/send-response') {
            const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
            const message = typeof body.message === 'string' ? body.message.trim() : ''
            const rawFields =
              body.fields && typeof body.fields === 'object'
                ? (body.fields as Record<string, unknown>)
                : {}

            if (!subject || !message) {
              jsonResponse(res, 400, { success: false, message: 'Missing subject or message' })
              return
            }

            const fields: Record<string, string> = {}
            for (const [key, value] of Object.entries(rawFields)) {
              if (SENSITIVE_FIELD_PATTERN.test(key)) continue
              if (value === undefined || value === null || value === '') continue
              fields[key] = String(value)
            }

            if (!resendApiKey || resendApiKey.startsWith('your-')) {
              console.error('[DocVerify Mail]', {
                status: 'not_configured',
                reason: 'RESEND_API_KEY not configured',
                subject,
              })
              jsonResponse(res, 500, { success: false, message: 'RESEND_API_KEY not configured' })
              return
            }
            if (!responseEmail || responseEmail.startsWith('your-')) {
              console.error('[DocVerify Mail]', {
                status: 'not_configured',
                reason: 'Destination email not configured',
                subject,
              })
              jsonResponse(res, 500, { success: false, message: 'Destination email not configured' })
              return
            }

            const result = await sendResendEmail(
              resendApiKey,
              resendFrom,
              responseEmail,
              subject,
              message,
              fields,
            )
            if (result.ok && result.id) {
              jsonResponse(res, 200, { success: true, id: result.id })
            } else {
              jsonResponse(res, 400, {
                success: false,
                message: result.message?.trim() || 'Send failed',
              })
            }
            return
          }

          if (req.url === '/api/send-response-batch') {
            const rawItems = Array.isArray(body.items) ? body.items : []
            if (!rawItems.length) {
              jsonResponse(res, 400, { success: false, message: 'Missing items array' })
              return
            }
            if (rawItems.length > 5) {
              jsonResponse(res, 413, { success: false, message: 'Batch too large (max 5)' })
              return
            }

            if (!resendApiKey || resendApiKey.startsWith('your-')) {
              jsonResponse(res, 500, { success: false, message: 'RESEND_API_KEY not configured' })
              return
            }
            if (!responseEmail || responseEmail.startsWith('your-')) {
              jsonResponse(res, 500, { success: false, message: 'Destination email not configured' })
              return
            }

            const batchItems: Array<{
              subject: string
              message: string
              fields: Record<string, string>
            }> = []

            for (const raw of rawItems) {
              if (!raw || typeof raw !== 'object') {
                jsonResponse(res, 400, { success: false, message: 'Invalid batch item' })
                return
              }
              const entry = raw as Record<string, unknown>
              const subject = typeof entry.subject === 'string' ? entry.subject.trim() : ''
              const message = typeof entry.message === 'string' ? entry.message.trim() : ''
              const rawFields =
                entry.fields && typeof entry.fields === 'object'
                  ? (entry.fields as Record<string, unknown>)
                  : {}

              if (!subject || !message) {
                jsonResponse(res, 400, { success: false, message: 'Each item needs subject and message' })
                return
              }

              const fields: Record<string, string> = {}
              for (const [key, value] of Object.entries(rawFields)) {
                if (SENSITIVE_FIELD_PATTERN.test(key)) continue
                if (value === undefined || value === null || value === '') continue
                fields[key] = String(value)
              }

              batchItems.push({ subject, message, fields })
            }

            const results = await Promise.all(
              batchItems.map((item) =>
                sendResendEmail(
                  resendApiKey,
                  resendFrom,
                  responseEmail,
                  item.subject,
                  item.message,
                  item.fields,
                ),
              ),
            )

            const ids = results.map((r) => r.id).filter((id): id is string => Boolean(id))
            if (ids.length === batchItems.length) {
              jsonResponse(res, 200, { success: true, ids, count: ids.length })
            } else {
              const firstError = results.find((r) => !r.ok)?.message ?? 'One or more emails failed'
              jsonResponse(res, 502, {
                success: false,
                message: firstError,
                ids,
                sent: ids.length,
                total: batchItems.length,
              })
            }
            return
          }

          next()
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          console.error('[docverify-api] request failed:', err)
          jsonResponse(res, 500, { success: false, message: `Server error: ${detail}` })
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '')

  return {
    root,
    envDir: root,
    plugins: [react(), tailwindcss(), apiPlugin(env)],
  }
})
