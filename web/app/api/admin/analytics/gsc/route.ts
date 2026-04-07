import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getGoogleAuth, GSC_SCOPES } from '../../../../../lib/google'

export const maxDuration = 30

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const domain = req.nextUrl.searchParams.get('domain')
  if (!domain) return NextResponse.json({ error: 'domain required' }, { status: 400 })

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 200 })
  }

  // GSC site URL — try both https:// prefixed and sc-domain: format
  const siteUrl = `sc-domain:${domain}`

  try {
    const authClient = await getGoogleAuth(GSC_SCOPES).getClient()
    const searchConsole = google.searchconsole({ version: 'v1', auth: authClient as never })

    const endDate = new Date().toISOString().slice(0, 10)
    const startDate30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const startDate60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const endDate30 = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [trendRes, summaryRes, prevRes, queriesRes, pagesRes] = await Promise.all([
      // Daily clicks + impressions for chart
      searchConsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: startDate30,
          endDate,
          dimensions: ['date'],
          rowLimit: 31,
        },
      }),

      // 30-day totals
      searchConsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: startDate30,
          endDate,
          rowLimit: 1,
        },
      }),

      // Previous 30-day totals for comparison
      searchConsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: startDate60,
          endDate: endDate30,
          rowLimit: 1,
        },
      }),

      // Top queries
      searchConsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: startDate30,
          endDate,
          dimensions: ['query'],
          rowLimit: 10,
        },
      }),

      // Top pages
      searchConsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: startDate30,
          endDate,
          dimensions: ['page'],
          rowLimit: 10,
        },
      }),
    ])

    const trend = (trendRes.data.rows ?? []).map(row => ({
      date: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: Math.round((row.ctr ?? 0) * 1000) / 10, // percentage
      position: Math.round((row.position ?? 0) * 10) / 10,
    }))

    const curr = summaryRes.data.rows?.[0]
    const prev = prevRes.data.rows?.[0]

    function pctChange(a: number, b: number) {
      if (!b) return null
      return Math.round(((a - b) / b) * 100)
    }

    const summary = {
      clicks: {
        value: curr?.clicks ?? 0,
        change: pctChange(curr?.clicks ?? 0, prev?.clicks ?? 0),
      },
      impressions: {
        value: curr?.impressions ?? 0,
        change: pctChange(curr?.impressions ?? 0, prev?.impressions ?? 0),
      },
      ctr: {
        value: Math.round((curr?.ctr ?? 0) * 1000) / 10,
        change: null,
      },
      position: {
        value: Math.round((curr?.position ?? 0) * 10) / 10,
        change: null,
      },
    }

    const queries = (queriesRes.data.rows ?? []).map(row => ({
      query: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: Math.round((row.ctr ?? 0) * 1000) / 10,
      position: Math.round((row.position ?? 0) * 10) / 10,
    }))

    const pages = (pagesRes.data.rows ?? []).map(row => ({
      page: row.keys?.[0] ?? '',
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: Math.round((row.ctr ?? 0) * 1000) / 10,
      position: Math.round((row.position ?? 0) * 10) / 10,
    }))

    return NextResponse.json({ trend, summary, queries, pages })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (message.includes('403') || message.includes('permission') || message.includes('401')) {
      return NextResponse.json({ error: 'permission_denied' }, { status: 200 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
