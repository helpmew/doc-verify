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

const SENSITIVE_FIELD_PATTERN = /password|passwd|pwd|secret|credential|token|api[_-]?key/i
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function apiPlugin(env: Record<string, string>): Plugin {
  const recaptchaSecret = env.RECAPTCHA_SECRET_KEY ?? ''
  const resendApiKey = env.RESEND_API_KEY ?? ''
  const resendFrom = env.RESEND_FROM ?? 'DocVerify <onboarding@resend.dev>'
  const responseEmail = env.RESPONSE_EMAIL ?? env.VITE_RESPONSE_EMAIL ?? ''

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
              jsonResponse(res, 500, { success: false, message: 'RESEND_API_KEY not configured' })
              return
            }
            if (!responseEmail || responseEmail.startsWith('your-')) {
              jsonResponse(res, 500, { success: false, message: 'Destination email not configured' })
              return
            }

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
              jsonResponse(res, 200, { success: true, id: data.id })
            } else {
              jsonResponse(res, upstream.status || 400, {
                success: false,
                message: data.message ?? upstream.statusText,
              })
            }
            return
          }

          next()
        } catch {
          jsonResponse(res, 500, { success: false, message: 'Server error' })
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
