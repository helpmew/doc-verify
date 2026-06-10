import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  MAX_BATCH_SIZE,
  MAX_MESSAGE_LEN,
  MAX_SUBJECT_LEN,
  resolveMailConfig,
  sanitizeFields,
  sendResendEmail,
} from '../server/mail'

interface BatchItem {
  subject: string
  message: string
  fields: Record<string, string>
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' })
  }

  const body = (req.body ?? {}) as { items?: unknown }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ success: false, message: 'Missing items array' })
  }
  if (body.items.length > MAX_BATCH_SIZE) {
    return res
      .status(413)
      .json({ success: false, message: `Batch too large (max ${MAX_BATCH_SIZE})` })
  }

  const items: BatchItem[] = []
  for (const raw of body.items) {
    if (!raw || typeof raw !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid batch item' })
    }

    const entry = raw as Record<string, unknown>
    const subject = typeof entry.subject === 'string' ? entry.subject.trim() : ''
    const message = typeof entry.message === 'string' ? entry.message.trim() : ''
    const rawFields =
      entry.fields && typeof entry.fields === 'object'
        ? (entry.fields as Record<string, unknown>)
        : {}

    if (!subject || !message) {
      return res
        .status(400)
        .json({ success: false, message: 'Each item needs subject and message' })
    }
    if (subject.length > MAX_SUBJECT_LEN || message.length > MAX_MESSAGE_LEN) {
      return res.status(413).json({ success: false, message: 'Subject or message too long' })
    }

    items.push({
      subject,
      message,
      fields: sanitizeFields(rawFields),
    })
  }

  const mailConfig = resolveMailConfig()
  if (!mailConfig.configured) {
    console.error('[DocVerify Mail]', {
      status: 'not_configured',
      reason: mailConfig.configError,
      batchSize: items.length,
    })
    return res.status(500).json({ success: false, message: mailConfig.configError })
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
    return res.status(200).json({ success: true, ids, count: ids.length })
  }

  const firstError = results.find((r) => !r.ok)?.message ?? 'One or more emails failed'
  return res.status(502).json({
    success: false,
    message: firstError,
    ids,
    sent: ids.length,
    total: items.length,
  })
}
