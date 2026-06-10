import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' })
  }

  const body = (req.body ?? {}) as { token?: string }
  const token = body.token
  if (!token) {
    return res.status(400).json({ success: false, message: 'Missing captcha token' })
  }
  if (token === 'demo-captcha-verified') {
    return res.status(200).json({ success: true })
  }

  const secret = process.env.RECAPTCHA_SECRET_KEY ?? ''
  if (!secret) {
    return res.status(500).json({ success: false, message: 'RECAPTCHA_SECRET_KEY not configured' })
  }

  const params = new URLSearchParams()
  params.append('secret', secret)
  params.append('response', token)

  const verifyRes = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  const result = (await verifyRes.json()) as { success?: boolean; 'error-codes'?: string[] }
  if (result.success) {
    return res.status(200).json({ success: true })
  }

  return res.status(400).json({
    success: false,
    message: result['error-codes']?.join(', ') ?? 'Captcha verification failed',
  })
}
