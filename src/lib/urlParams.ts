export interface PersonalizedUrlParams {
  ref: string | null
  session: string | null
  email: string | null
}

function cleanParam(value: string | null): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed || null
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value).trim()
  } catch {
    return value.trim()
  }
}

/**
 * Read personalized URL query parameters from the current page (or a given search string).
 * Works in development and production — purely client-side, no build-time config.
 *
 * @example
 * https://docverifi.netlify.app/?ref=847c8b61&session=00625a2f&email=user@example.com
 */
export function getPersonalizedUrlParams(
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): PersonalizedUrlParams {
  const params = new URLSearchParams(search)

  const email = params.get('email')
  const ref = params.get('ref')
  const session = params.get('session')

  return {
    ref: ref ? decodeParam(ref) : null,
    session: session ? decodeParam(session) : null,
    email: email ? decodeParam(email) : null,
  }
}
