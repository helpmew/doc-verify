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

  let body: { subject?: string; message?: string; fields?: Record<string, string> }
  try {
    body = (await req.json()) as {
      subject?: string
      message?: string
      fields?: Record<string, string>
    }
  } catch {
    return json(400, { success: false, message: 'Invalid JSON' })
  }

  const subject = body.subject
  const message = body.message
  const fields = body.fields ?? {}

  if (!subject || !message) {
    return json(400, { success: false, message: 'Missing subject or message' })
  }

  const responseEmail = process.env.VITE_RESPONSE_EMAIL ?? ''
  const responseEndpoint = process.env.VITE_RESPONSE_ENDPOINT ?? ''
  const web3formsKey =
    process.env.WEB3FORMS_ACCESS_KEY ?? process.env.VITE_WEB3FORMS_ACCESS_KEY ?? ''

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
    return json(500, { success: false, message: 'WEB3FORMS_ACCESS_KEY not configured' })
  }

  const data = (await upstream.json()) as { success?: boolean; message?: string }
  if (upstream.ok && data.success !== false) {
    return json(200, { success: true, message: data.message })
  }

  return json(400, {
    success: false,
    message: data.message ?? upstream.statusText,
  })
}
