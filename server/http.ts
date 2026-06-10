import type { VercelRequest } from '@vercel/node'

export function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  const header = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return (header?.split(',')[0] ?? req.socket?.remoteAddress ?? '').trim() || 'unknown'
}
