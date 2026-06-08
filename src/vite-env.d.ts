/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string
  readonly VITE_RECAPTCHA_SITE_KEY: string
  readonly VITE_THUMIO_AUTH_KEY: string
  readonly VITE_RESPONSE_EMAIL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __DOCVERIFY_BG__?: { domain: string; url: string }
}
