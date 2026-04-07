import { google } from 'googleapis'

/**
 * Returns an authenticated Google API client using the service account key.
 * Store the full service account JSON as GOOGLE_SERVICE_ACCOUNT_KEY in env vars.
 */
export function getGoogleAuth(scopes: string[]) {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set')
  const credentials = JSON.parse(keyJson)
  return new google.auth.GoogleAuth({ credentials, scopes })
}

export const GA4_SCOPES = ['https://www.googleapis.com/auth/analytics.readonly']
export const GSC_SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly']
