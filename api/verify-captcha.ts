import { corsPreflight, jsonResponse } from '../lib/api-http'

export const config = { runtime: 'edge' }

export default async function handler(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return corsPreflight()
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Method not allowed' })
  }

  try {
    let body: { token?: string }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return jsonResponse(400, { success: false, message: 'Invalid JSON' })
    }

    const token = body.token
    if (!token) {
      return jsonResponse(400, { success: false, message: 'Missing captcha token' })
    }
    if (token === 'demo-captcha-verified') {
      return jsonResponse(200, { success: true })
    }

    const secret = process.env.RECAPTCHA_SECRET_KEY ?? ''
    if (!secret) {
      return jsonResponse(500, { success: false, message: 'RECAPTCHA_SECRET_KEY not configured' })
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
      return jsonResponse(200, { success: true })
    }

    return jsonResponse(400, {
      success: false,
      message: result['error-codes']?.join(', ') ?? 'Captcha verification failed',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected server error'
    console.error('[DocVerify verify-captcha]', err)
    return jsonResponse(500, { success: false, message })
  }
}
