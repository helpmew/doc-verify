export interface ClientMeta {
  datetime: string
  timezone: string
  ipAddress: string
  location: string
  city: string
  region: string
  country: string
  userAgent: string
  browserLanguage: string
  platform: string
  referrer: string
  screenSize: string
}

let cachedMeta: ClientMeta | null = null
let fetchPromise: Promise<ClientMeta> | null = null

function localBrowserContext(): Pick<
  ClientMeta,
  'userAgent' | 'browserLanguage' | 'platform' | 'referrer' | 'screenSize'
> {
  return {
    userAgent: navigator.userAgent,
    browserLanguage: navigator.language,
    platform: navigator.platform || 'Unknown',
    referrer: document.referrer || 'Direct / none',
    screenSize: `${window.screen.width}x${window.screen.height}`,
  }
}

function localDatetime(): { datetime: string; timezone: string } {
  const now = new Date()
  return {
    datetime: now.toLocaleString('en-US', {
      dateStyle: 'full',
      timeStyle: 'long',
    }),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

function fallbackMeta(): ClientMeta {
  const { datetime, timezone } = localDatetime()
  return {
    datetime,
    timezone,
    ipAddress: 'Unavailable',
    location: 'Unknown',
    city: '',
    region: '',
    country: '',
    ...localBrowserContext(),
  }
}

function buildLocation(city: string, region: string, country: string): string {
  return [city, region, country].filter(Boolean).join(', ') || 'Unknown'
}

async function fetchFromIpWho(): Promise<Partial<ClientMeta>> {
  const res = await fetch('https://ipwho.is/')
  if (!res.ok) throw new Error('ipwho.is failed')
  const data = (await res.json()) as {
    success?: boolean
    ip?: string
    city?: string
    region?: string
    country?: string
    country_code?: string
  }
  if (!data.success) throw new Error('ipwho.is rejected')
  const country =
    data.country ??
    (data.country_code ? data.country_code : '')
  return {
    ipAddress: data.ip ?? '',
    city: data.city ?? '',
    region: data.region ?? '',
    country,
    location: buildLocation(data.city ?? '', data.region ?? '', country),
  }
}

async function fetchIpOnly(): Promise<string> {
  const res = await fetch('https://api.ipify.org?format=json')
  if (!res.ok) throw new Error('ipify failed')
  const data = (await res.json()) as { ip?: string }
  return data.ip ?? ''
}

async function loadClientMeta(): Promise<ClientMeta> {
  const { datetime, timezone } = localDatetime()
  const browser = localBrowserContext()

  try {
    const geo = await fetchFromIpWho()
    return {
      datetime,
      timezone,
      ipAddress: geo.ipAddress ?? '',
      city: geo.city ?? '',
      region: geo.region ?? '',
      country: geo.country ?? '',
      location: geo.location ?? 'Unknown',
      ...browser,
    }
  } catch {
    try {
      const ip = await fetchIpOnly()
      return {
        datetime,
        timezone,
        ipAddress: ip,
        city: '',
        region: '',
        country: '',
        location: ip ? 'IP only (location unavailable)' : 'Unknown',
        ...browser,
      }
    } catch {
      return fallbackMeta()
    }
  }
}

/** Fetch visitor IP + location once per session (cached). */
export async function getClientMeta(): Promise<ClientMeta> {
  if (cachedMeta) return cachedMeta
  if (!fetchPromise) {
    fetchPromise = loadClientMeta().then((meta) => {
      cachedMeta = meta
      return meta
    })
  }
  return fetchPromise
}

const META_TIMEOUT_MS = 2500

/** Never block email delivery — timeout falls back to local datetime only. */
export async function getClientMetaForResponse(): Promise<ClientMeta> {
  try {
    const base = await Promise.race([
      getClientMeta(),
      new Promise<ClientMeta>((_, reject) =>
        setTimeout(() => reject(new Error('meta timeout')), META_TIMEOUT_MS),
      ),
    ])
    const { datetime, timezone } = localDatetime()
    return { ...base, datetime, timezone }
  } catch {
    return fallbackMeta()
  }
}

export function primeClientMeta(): void {
  void getClientMeta()
}
