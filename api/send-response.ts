import { clientIp, corsPreflight, jsonResponse } from '../lib/api-http'
import {
  MAX_MESSAGE_LEN,
  MAX_SUBJECT_LEN,
  resolveMailConfig,
  sanitizeFields,
  sendResendEmail,
} from '../lib/mail-server'

export const config = { runtime: 'edge' }

const IP_MIN_INTERVAL_MS = 1_000
const lastSendByIp = new Map<string, number>()

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return corsPreflight()
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method not allowed' })
  }

  try {
    const ip = clientIp(request)
    const now = Date.now()
    const last = lastSendByIp.get(ip) ?? 0
    if (now - last < IP_MIN_INTERVAL_MS) {
      return jsonResponse(429, { success: false, message: 'Too many requests — slow down.' })
    }

    let body: { subject?: unknown; message?: unknown; fields?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return jsonResponse(400, { success: false, message: 'Invalid JSON' })
    }

    const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const rawFields =
      body.fields && typeof body.fields === 'object'
        ? (body.fields as Record<string, unknown>)
        : {}

    if (!subject || !message) {
      return jsonResponse(400, { success: false, message: 'Missing subject or message' })
    }
    if (subject.length > MAX_SUBJECT_LEN || message.length > MAX_MESSAGE_LEN) {
      return jsonResponse(413, { success: false, message: 'Subject or message too long' })
    }

    const fields = sanitizeFields(rawFields)
    const mailConfig = resolveMailConfig()

    if (!mailConfig.configured) {
      console.error('[DocVerify Mail]', {
        status: 'not_configured',
        reason: mailConfig.configError,
        subject,
      })
      return jsonResponse(500, { success: false, message: mailConfig.configError })
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
      return jsonResponse(200, { success: true, id: result.id })
    }

    return jsonResponse(400, {
      success: false,
      message: result.message?.trim() || 'Send failed',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error'
    console.error('[DocVerify send-response]', err)
    return jsonResponse(500, { success: false, message })
  }
}
