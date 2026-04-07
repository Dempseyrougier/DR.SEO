import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { getGoogleAuth, GA4_SCOPES } from '../../../../../lib/google'

export const maxDuration = 30

function auth(req: NextRequest) {
  return req.headers.get('x-admin-key') === process.env.ADMIN_KEY
}

export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const propertyId = req.nextUrl.searchParams.get('property_id')
  if (!propertyId) return NextResponse.json({ error: 'property_id required' }, { status: 400 })

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return NextResponse.json({ error: 'not_configured' }, { status: 200 })
  }

  try {
    const authClient = await getGoogleAuth(GA4_SCOPES).getClient()
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth: authClient as never })

    const property = `properties/${propertyId}`

    // Run two reports in parallel: daily trend + summary + top pages
    const [trendRes, summaryRes, channelsRes, pagesRes] = await Promise.all([
      // Daily sessions for the last 30 days (chart data)
      analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
          orderBys: [{ dimension: { dimensionName: 'date' } }],
        },
      }),

      // 30-day summary vs previous 30
      analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [
            { startDate: '30daysAgo', endDate: 'today' },
            { startDate: '60daysAgo', endDate: '31daysAgo' },
          ],
          metrics: [
            { name: 'sessions' },
            { name: 'activeUsers' },
            { name: 'screenPageViews' },
            { name: 'engagementRate' },
            { name: 'averageSessionDuration' },
          ],
        },
      }),

      // Sessions by channel
      analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'sessionDefaultChannelGroup' }],
          metrics: [{ name: 'sessions' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '8',
        },
      }),

      // Top landing pages
      analyticsData.properties.runReport({
        property,
        requestBody: {
          dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'landingPagePlusQueryString' }],
          metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'engagementRate' }],
          orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
          limit: '10',
        },
      }),
    ])

    // Parse trend data
    const trend = (trendRes.data.rows ?? []).map(row => ({
      date: row.dimensionValues?.[0].value ?? '',
      sessions: parseInt(row.metricValues?.[0].value ?? '0'),
      users: parseInt(row.metricValues?.[1].value ?? '0'),
    }))

    // Parse summary (current period = index 0, previous = index 1)
    const currentRow = summaryRes.data.rows?.[0]
    const previousRow = summaryRes.data.rows?.[1]
    const getMetric = (row: typeof currentRow, i: number) =>
      parseFloat(row?.metricValues?.[i]?.value ?? '0')

    function pctChange(curr: number, prev: number) {
      if (prev === 0) return null
      return Math.round(((curr - prev) / prev) * 100)
    }

    const summary = {
      sessions: {
        value: Math.round(getMetric(currentRow, 0)),
        change: pctChange(getMetric(currentRow, 0), getMetric(previousRow, 0)),
      },
      users: {
        value: Math.round(getMetric(currentRow, 1)),
        change: pctChange(getMetric(currentRow, 1), getMetric(previousRow, 1)),
      },
      pageviews: {
        value: Math.round(getMetric(currentRow, 2)),
        change: pctChange(getMetric(currentRow, 2), getMetric(previousRow, 2)),
      },
      engagementRate: {
        value: Math.round(getMetric(currentRow, 3) * 100),
        change: pctChange(getMetric(currentRow, 3), getMetric(previousRow, 3)),
      },
      avgSessionDuration: {
        value: Math.round(getMetric(currentRow, 4)),
        change: null,
      },
    }

    // Parse channels
    const channels = (channelsRes.data.rows ?? []).map(row => ({
      channel: row.dimensionValues?.[0].value ?? 'Unknown',
      sessions: parseInt(row.metricValues?.[0].value ?? '0'),
    }))

    // Parse top pages
    const topPages = (pagesRes.data.rows ?? []).map(row => ({
      page: row.dimensionValues?.[0].value ?? '/',
      sessions: parseInt(row.metricValues?.[0].value ?? '0'),
      users: parseInt(row.metricValues?.[1].value ?? '0'),
      engagementRate: Math.round(parseFloat(row.metricValues?.[2].value ?? '0') * 100),
    }))

    return NextResponse.json({ trend, summary, channels, topPages })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    // Return structured error so UI can show helpful message
    if (message.includes('403') || message.includes('permission')) {
      return NextResponse.json({ error: 'permission_denied' }, { status: 200 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
