/**
 * Cookie debugging utility.
 *
 * Reads cookies that are accessible to JavaScript via `document.cookie` and
 * parses them into a plain object for inspection during local development.
 *
 * Note: cookies flagged `HttpOnly` are intentionally invisible to JavaScript
 * and will never appear here. That is a browser security guarantee, not a bug.
 * This utility makes no attempt to work around it.
 */

export type ParsedCookies = Record<string, string>

/**
 * Parse a raw cookie string (the format of `document.cookie`) into key/value
 * pairs. Values are URL-decoded when possible.
 */
export function parseCookieString(raw: string): ParsedCookies {
  const result: ParsedCookies = {}

  if (!raw) return result

  for (const part of raw.split(';')) {
    const segment = part.trim()
    if (!segment) continue

    const eqIndex = segment.indexOf('=')
    // Cookies with no "=" are treated as a flag-style key with an empty value.
    const rawKey = eqIndex === -1 ? segment : segment.slice(0, eqIndex)
    const rawValue = eqIndex === -1 ? '' : segment.slice(eqIndex + 1)

    const key = safeDecode(rawKey.trim())
    const value = safeDecode(rawValue.trim())

    if (key) result[key] = value
  }

  return result
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Read and parse the cookies currently visible to JavaScript on this page.
 * Returns an empty object in non-browser environments (e.g. SSR/tests).
 */
export function getReadableCookies(): ParsedCookies {
  if (typeof document === 'undefined') return {}
  return parseCookieString(document.cookie)
}

/**
 * Log the JavaScript-readable cookies to the console for debugging.
 *
 * Returns the parsed object so callers can both inspect and reuse the result.
 */
export function logReadableCookies(): ParsedCookies {
  const cookies = getReadableCookies()
  const keys = Object.keys(cookies)

  if (keys.length === 0) {
    // eslint-disable-next-line no-console
    console.info(
      '[cookieDebug] No cookies are readable via document.cookie. ' +
        'Any cookies set for this site are likely protected by HttpOnly, ' +
        'Secure, or SameSite settings and are intentionally inaccessible to JavaScript.',
    )
    return cookies
  }

  // eslint-disable-next-line no-console
  console.groupCollapsed(`[cookieDebug] ${keys.length} readable cookie(s)`)
  // eslint-disable-next-line no-console
  console.table(cookies)
  // eslint-disable-next-line no-console
  console.info(
    'Reminder: HttpOnly cookies are not listed here by design — ' +
      'the browser hides them from JavaScript.',
  )
  // eslint-disable-next-line no-console
  console.groupEnd()

  return cookies
}
