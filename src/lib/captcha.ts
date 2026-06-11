import { apiUrl } from './api'

/** Server-side reCAPTCHA verification (dev: Vite middleware at /api/verify-captcha) */
export async function verifyCaptchaToken(token: string): Promise<{ ok: boolean; message?: string }> {
  if (token === 'demo-captcha-verified') {
    return { ok: true }
  }

  try {
    const res = await fetch(apiUrl('/api/verify-captcha'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })

    const data = (await res.json()) as { success?: boolean; message?: string }

    if (res.ok && data.success) {
      return { ok: true }
    }

    return { ok: false, message: data.message ?? 'Captcha verification failed' }
  } catch {
    return { ok: false, message: 'Could not reach captcha verification service' }
  }
}
