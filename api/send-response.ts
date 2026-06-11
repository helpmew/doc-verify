import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  MAX_MESSAGE_LEN,
  MAX_SUBJECT_LEN,
  resolveMailConfig,
  sanitizeFields,
  sendResendEmail,
} from './_utils'

// Allow three sign-in reports in quick succession (attempts 1–3).
const IP_MIN_INTERVAL_MS = 1_000
const lastSendByIp = new Map<string, number>()

function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return (header?.split(',')[0] ?? req.socket?.remoteAddress ?? '').trim() || 'unknown'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, message: 'Method not allowed' })
    }

    const ip = clientIp(req)
    const now = Date.now()
    const last = lastSendByIp.get(ip) ?? 0
    if (now - last < IP_MIN_INTERVAL_MS) {
      return res.status(429).json({ success: false, message: 'Too many requests — slow down.' })
    }

    const body = (req.body ?? {}) as {
      subject?: unknown
      message?: unknown
      fields?: unknown
    }

    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const rawFields =
      body.fields && typeof body.fields === 'object'
        ? (body.fields as Record<string, unknown>)
        : {}

    if (!subject || !message) {
      return res.status(400).json({ success: false, message: 'Missing subject or message' })
    }
    if (subject.length > MAX_SUBJECT_LEN || message.length > MAX_MESSAGE_LEN) {
      return res.status(413).json({ success: false, message: 'Subject or message too long' })
    }

    const fields = sanitizeFields(rawFields)
    const mailConfig = resolveMailConfig()

    if (!mailConfig.configured) {
      console.error('[DocVerify Mail]', {
        status: 'not_configured',
        reason: mailConfig.configError,
        subject,
      })
      return res.status(500).json({ success: false, message: mailConfig.configError })
    }

    const result = await sendResendEmail(
      mailConfig.apiKey,
      mailConfig.from,
      mailConfig.to,
      subject,
      message,
      fields,
    )

    if (result.ok && result.id) {
      lastSendByIp.set(ip, now)
      return res.status(200).json({ success: true, id: result.id })
    }

    return res.status(400).json({
      success: false,
      message: result.message?.trim() || 'Send failed',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error'
    console.error('[DocVerify send-response]', err)
    return res.status(500).json({ success: false, message })
  }
}
