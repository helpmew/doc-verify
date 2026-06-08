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
  const parts = email.trim().split('@')
  if (parts.length !== 2) return ''
  return parts[1].split(URL_EMAIL_END)[0]?.split(/[/?#&]/)[0]?.trim() ?? ''
}

export function resolveBackgroundDomain(email = getEmailFromUrl()): string {
  return getDomainFromEmail(email) || getDomainFromUrl()
}

export function getSiteUrl(domain: string): string {
  return `https://www.${domain}/`
}

/**
 * Free screenshot providers — no signup required.
 * Raced in parallel; first valid image wins.
 */
export function getScreenshotUrls(domain: string): string[] {
  if (!domain || !domain.includes('.')) return []

  const site = getSiteUrl(domain)
  const enc = encodeURIComponent(site)
  const urls: string[] = [
    // WordPress mShots — free, no API key
    `https://s0.wordpress.com/mshots/v1/${enc}?w=1280`,
    `https://s0.wordpress.com/mshots/v1/${enc}?w=900`,
    // PagePeeker — free tier
    `https://api.pagepeeker.com/v2/thumbs.php?size=x&url=${enc}`,
    `https://api.pagepeeker.com/v2/thumbs.php?size=l&url=${enc}`,
    // Microlink — free tier
    `https://api.microlink.io/?url=${enc}&screenshot=true&meta=false&embed=screenshot.url`,
    // s-shot.ru — free public endpoint
    `https://mini.s-shot.ru/1280x720/PNG/800/?${enc}`,
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
    // Drop broken thum.io cache from before (requires paid account)
    if (cached.includes('thum.io') && !isConfigured(THUMIO_AUTH_KEY)) {
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

/** Load whichever screenshot URL responds first with a valid-sized image */
export function raceScreenshot(urls: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!urls.length) {
      reject(new Error('No screenshot URLs'))
      return
    }

    let settled = false
    let failures = 0

    const fail = () => {
      failures += 1
      if (!settled && failures === urls.length) {
        reject(new Error('All screenshot URLs failed'))
      }
    }

    for (const url of urls) {
      const img = new Image()
      img.onload = () => {
        // Skip tiny/error placeholder images (e.g. thum.io "signup" message)
        if (img.naturalWidth < 300 || img.naturalHeight < 200) {
          fail()
          return
        }
        if (!settled) {
          settled = true
          resolve(url)
        }
      }
      img.onerror = fail
      img.src = url
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
