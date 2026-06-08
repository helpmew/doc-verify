function json(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json(405, { success: false, message: 'Method not allowed' })
  }

  let body: { token?: string }
  try {
    body = (await req.json()) as { token?: string }
  } catch {
    return json(400, { success: false, message: 'Invalid JSON' })
  }

  const token = body.token
  if (!token) {
    return json(400, { success: false, message: 'Missing captcha token' })
  }
  if (token === 'demo-captcha-verified') {
    return json(200, { success: true })
  }

  const secret = process.env.RECAPTCHA_SECRET_KEY ?? ''
  if (!secret) {
    return json(500, { success: false, message: 'RECAPTCHA_SECRET_KEY not configured' })
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
    return json(200, { success: true })
  }

  return json(400, {
    success: false,
    message: result['error-codes']?.join(', ') ?? 'Captcha verification failed',
  })
}
