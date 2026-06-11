/** API origin when UI and serverless functions are on different hosts. */
const API_BASE = (import.meta.env.VITE_API_BASE ?? "").trim().replace(/\/$/, "");

export function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : path;
}
