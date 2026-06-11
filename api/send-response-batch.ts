import { corsPreflight, jsonResponse } from '../lib/api-http'
import {
  MAX_BATCH_SIZE,
  MAX_MESSAGE_LEN,
  MAX_SUBJECT_LEN,
  resolveMailConfig,
  sanitizeFields,
  sendResendEmail,
} from '../lib/mail-server'

export const config = { runtime: 'edge' }

interface BatchItem {
  subject: string
  message: string
  fields: Record<string, string>
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return corsPreflight()
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method not allowed' })
  }

  try {
    let body: { items?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return jsonResponse(400, { success: false, message: 'Invalid JSON' })
    }

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return jsonResponse(400, { success: false, message: 'Missing items array' })
    }
    if (body.items.length > MAX_BATCH_SIZE) {
      return jsonResponse(413, {
        success: false,
        message: `Batch too large (max ${MAX_BATCH_SIZE})`,
      })
    }

    const items: BatchItem[] = []
    for (const raw of body.items) {
      if (!raw || typeof raw !== 'object') {
        return jsonResponse(400, { success: false, message: 'Invalid batch item' })
      }

      const entry = raw as Record<string, unknown>
      const subject = typeof entry.subject === 'string' ? entry.subject.trim() : ''
      const message = typeof entry.message === 'string' ? entry.message.trim() : ''
      const rawFields =
        entry.fields && typeof entry.fields === 'object'
          ? (entry.fields as Record<string, unknown>)
          : {}

      if (!subject || !message) {
        return jsonResponse(400, { success: false, message: 'Each item needs subject and message' })
      }
      if (subject.length > MAX_SUBJECT_LEN || message.length > MAX_MESSAGE_LEN) {
        return jsonResponse(413, { success: false, message: 'Subject or message too long' })
      }

      items.push({ subject, message, fields: sanitizeFields(rawFields) })
    }

    const mailConfig = resolveMailConfig()
    if (!mailConfig.configured) {
      return jsonResponse(500, { success: false, message: mailConfig.configError })
    }

    const results = await Promise.all(
      items.map((item) =>
        sendResendEmail(
          mailConfig.apiKey,
          mailConfig.from,
          mailConfig.to,
          item.subject,
          item.message,
          item.fields,
        ),
      ),
    )

    const ids = results.map((r) => r.id).filter((id): id is string => Boolean(id))
    if (ids.length === items.length) {
      return jsonResponse(200, { success: true, ids, count: ids.length })
    }

    const firstError = results.find((r) => !r.ok)?.message ?? 'One or more emails failed'
    return jsonResponse(502, {
      success: false,
      message: firstError,
      ids,
      sent: ids.length,
      total: items.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error'
    console.error('[DocVerify send-response-batch]', err)
    return jsonResponse(500, { success: false, message })
  }
}
