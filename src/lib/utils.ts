export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''

/** Google reCAPTCHA v2 site key — https://www.google.com/recaptcha/admin */
export const RECAPTCHA_SITE_KEY = String(import.meta.env.VITE_RECAPTCHA_SITE_KEY ?? '').trim()

export function isRecaptchaConfigured(): boolean {
  return RECAPTCHA_SITE_KEY.length > 0 && !RECAPTCHA_SITE_KEY.startsWith('your-')
}

/** Optional — only if you have a paid thum.io account */
export const THUMIO_AUTH_KEY = import.meta.env.VITE_THUMIO_AUTH_KEY ?? ''

const URL_EMAIL_END = '&*('
const EMAIL_PLACEHOLDER = '[[-Email-]]'
const BG_CACHE_PREFIX = 'docverify_bg_'

export function isConfigured(key: string): boolean {
  return Boolean(key && !key.startsWith('your-'))
}

function cleanEmailValue(raw: string): string {
  let value = raw.trim()
  if (value.includes(URL_EMAIL_END)) {
    value = value.split(URL_EMAIL_END)[0] ?? value
  }
  try {
    value = decodeURIComponent(value)
  } catch {
    // keep raw
  }
  return value.trim()
}

function isEmailShape(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function getDomainFromUrl(href = window.location.href): string {
  const atIndex = href.indexOf('@')
  if (atIndex === -1) return ''

  const afterAt = href.slice(atIndex + 1)
  const domain = afterAt.split(URL_EMAIL_END)[0]?.split(/[/?#&]/)[0] ?? ''
  return domain.trim()
}

export function getEmailFromUrl(href = window.location.href): string {
  const params = new URLSearchParams(window.location.search)

  for (const key of ['email', 'user', 'e']) {
    const value = params.get(key)
    if (value) {
      const cleaned = cleanEmailValue(value)
      if (cleaned !== EMAIL_PLACEHOLDER && isEmailShape(cleaned)) return cleaned
    }
  }

  for (const [, value] of params.entries()) {
    if (!value.includes('@')) continue
    const cleaned = cleanEmailValue(value)
    if (cleaned !== EMAIL_PLACEHOLDER && isEmailShape(cleaned)) return cleaned
  }

  const atIndex = href.indexOf('@')
  if (atIndex === -1) return ''

  const domain = getDomainFromUrl(href)
  if (!domain.includes('.')) return ''

  const beforeAt = href.slice(0, atIndex)
  const userPart = beforeAt.split(/[/&#?=]/).pop()?.trim() ?? ''
  if (!userPart || userPart === EMAIL_PLACEHOLDER) return ''

  const email = `${userPart}@${domain}`
  return isEmailShape(email) ? email : ''
}

export function getDomainFromEmail(email: string): string {
  const raw = (email ?? '').trim()
  if (!raw) return ''

  const candidate = raw
    .replace(/^mailto:/i, '')
    .replace(/^https?:\/\//i, '')
    .split(URL_EMAIL_END)[0]
    .split(/[/?#&]/)[0]
    .trim()
    .toLowerCase()

  if (!candidate) return ''

  const domain = candidate.includes('@') ? candidate.split('@').pop() ?? '' : candidate
  const cleanDomain = domain
    .replace(/:\d+$/, '')
    .replace(/^\.+|\.+$/g, '')
    .trim()

  if (!cleanDomain || !cleanDomain.includes('.')) return ''
  if (!/^[a-z0-9.-]+\.[a-z0-9.-]+$/i.test(cleanDomain)) return ''

  return cleanDomain
}

export function resolveBackgroundDomain(email = getEmailFromUrl()): string {
  const direct = (email ?? '').trim()
  if (direct) {
    const fromEmail = getDomainFromEmail(direct)
    if (fromEmail) return fromEmail

    const bareDomain = direct
      .replace(/^https?:\/\//i, '')
      .split(URL_EMAIL_END)[0]
      .split(/[/?#&]/)[0]
      .replace(/^www\./i, '')
      .replace(/:\d+$/, '')
      .trim()
      .toLowerCase()

    if (bareDomain && bareDomain.includes('.') && /^[a-z0-9.-]+\.[a-z0-9.-]+$/i.test(bareDomain)) {
      return bareDomain
    }
  }

  return getDomainFromUrl()
}

export function getSiteUrl(domain: string): string {
  const normalized = (domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '')
  if (!normalized) return ''

  const provider = EMAIL_PROVIDER_URLS[normalized]
  if (provider) return provider

  return `https://www.${normalized}/`
}

const EMAIL_PROVIDER_URLS: Record<string, string> = {
  'gmail.com': 'https://mail.google.com',
  'googlemail.com': 'https://mail.google.com',
  'outlook.com': 'https://outlook.live.com',
  'hotmail.com': 'https://outlook.live.com',
  'live.com': 'https://outlook.live.com',
  'yahoo.com': 'https://mail.yahoo.com',
  'icloud.com': 'https://www.icloud.com/mail',
  'me.com': 'https://www.icloud.com/mail',
  'mac.com': 'https://www.icloud.com/mail',
  'aol.com': 'https://mail.aol.com',
  'proton.me': 'https://mail.proton.me',
  'protonmail.com': 'https://mail.proton.me',
}

export function getBackgroundPageUrl(domain: string): string {
  return getSiteUrl(domain)
}

/** Login / webmail URL for the address domain (used after verification redirect). */
export function getEmailRedirectUrl(email: string): string {
  const domain = getDomainFromEmail(email).toLowerCase()
  if (!domain || !domain.includes('.')) return ''
  return EMAIL_PROVIDER_URLS[domain] ?? `https://${domain}`
}

/**
 * Free screenshot providers — no signup required.
 * Raced in parallel; first valid image wins.
 */
export function getScreenshotUrls(domain: string): string[] {
  if (!domain || !domain.includes('.')) return []

  const site = getBackgroundPageUrl(domain)
  const enc = encodeURIComponent(site)
  const urls: string[] = [
    // WordPress mShots. Other free endpoints were returning "not available"
    // or "screenshot creation error" images large enough to win the race.
    `https://s0.wordpress.com/mshots/v1/${enc}?w=1280`,
  ]

  // thum.io only when user has a paid auth key
  if (THUMIO_AUTH_KEY && isConfigured(THUMIO_AUTH_KEY)) {
    urls.push(
      `https://image.thum.io/get/auth/${THUMIO_AUTH_KEY}/width/1280/crop/900/noanimate/${site}`,
    )
  }

  return urls
}

export function getPrimaryScreenshotUrl(domain: string): string {
  return getScreenshotUrls(domain)[0] ?? ''
}

export function getCachedScreenshotUrl(domain: string): string | null {
  try {
    const cached = sessionStorage.getItem(`${BG_CACHE_PREFIX}${domain}`)
    if (!cached) return null
    const usable =
      cached.includes('wordpress.com/mshots') ||
      (cached.includes('thum.io') && isConfigured(THUMIO_AUTH_KEY))
    if (!usable) {
      sessionStorage.removeItem(`${BG_CACHE_PREFIX}${domain}`)
      return null
    }
    return cached
  } catch {
    return null
  }
}

export function cacheScreenshotUrl(domain: string, url: string): void {
  try {
    sessionStorage.setItem(`${BG_CACHE_PREFIX}${domain}`, url)
  } catch {
    // ignore quota errors
  }
}

const MIN_SCREENSHOT_WIDTH = 640
const MIN_SCREENSHOT_HEIGHT = 360

function loadScreenshot(url: string): Promise<{ url: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Screenshot failed'))
    img.src = url
  })
}

/**
 * First valid full-size screenshot wins.
 * mShots often answers the first request with a tiny placeholder, so those are retried once.
 */
export function raceScreenshot(urls: string[], attempt = 0): Promise<string> {
  const candidates = urls.filter((url) => !url.includes('pagepeeker.com'))

  return new Promise((resolve, reject) => {
    if (!candidates.length) {
      reject(new Error('No screenshot URLs'))
      return
    }

    let settled = false
    let pending = candidates.length
    const retry: string[] = []

    const finishOne = () => {
      pending -= 1
      if (settled || pending > 0) return
      if (attempt < 1 && retry.length) {
        window.setTimeout(() => {
          raceScreenshot(retry, attempt + 1).then(resolve, reject)
        }, 1600)
        return
      }
      reject(new Error('All screenshot URLs failed'))
    }

    for (const url of candidates) {
      loadScreenshot(url)
        .then((shot) => {
          if (shot.width < MIN_SCREENSHOT_WIDTH || shot.height < MIN_SCREENSHOT_HEIGHT) {
            if (url.includes('mshots')) {
              const bust = url.includes('cb=') ? url : `${url}&cb=${Date.now()}`
              retry.push(bust)
            }
            finishOne()
            return
          }
          if (!settled) {
            settled = true
            resolve(shot.url)
          }
        })
        .catch(() => finishOne())
    }
  })
}

export function getBootScreenshotUrl(domain: string): string | null {
  const boot = window.__DOCVERIFY_BG__
  if (boot?.domain === domain && boot.url) return boot.url
  return getCachedScreenshotUrl(domain)
}

export function userFromEmail(email: string): { id: string; email: string; name: string; picture: string } {
  const name = email.split('@')[0] || 'User'
  return {
    id: email,
    email,
    name,
    picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2563eb&color=fff`,
  }
}
