import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../lib/supabase'

export const maxDuration = 60

function auth(req: NextRequest) {
  if (req.headers.get('x-admin-key') === process.env.ADMIN_KEY) return true
  // Vercel Cron sends Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return true
  return false
}

// Check which companies are due for a new post and return a status report
export async function GET(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, domain, posts_per_week, active')
    .eq('active', true)

  if (!companies?.length) return NextResponse.json({ schedule: [] })

  const schedule = await Promise.all(companies.map(async company => {
    const { data: lastPost } = await supabase
      .from('posts')
      .select('created_at')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const { count: draftCount } = await supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', company.id)
      .eq('status', 'draft')

    const daysSinceLast = lastPost?.created_at
      ? Math.floor((Date.now() - new Date(lastPost.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 999

    const daysPerPost = Math.floor(7 / company.posts_per_week)
    const isDue = daysSinceLast >= daysPerPost
    const daysUntilDue = Math.max(0, daysPerPost - daysSinceLast)

    return {
      company_id: company.id,
      company_name: company.name,
      posts_per_week: company.posts_per_week,
      days_since_last_post: daysSinceLast === 999 ? null : daysSinceLast,
      days_until_due: daysUntilDue,
      is_due: isDue,
      draft_count: draftCount ?? 0,
      last_post_date: lastPost?.created_at ?? null,
    }
  }))

  return NextResponse.json({ schedule })
}

// Trigger writing for all overdue companies
export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getSupabaseAdmin()
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, posts_per_week, active')
    .eq('active', true)

  if (!companies?.length) return NextResponse.json({ message: 'No active companies.' })

  const due: string[] = []
  for (const company of companies) {
    const { data: lastPost } = await supabase
      .from('posts')
      .select('created_at')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const daysSinceLast = lastPost?.created_at
      ? Math.floor((Date.now() - new Date(lastPost.created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 999

    const daysPerPost = Math.floor(7 / company.posts_per_week)
    if (daysSinceLast >= daysPerPost) due.push(company.id)
  }

  if (!due.length) {
    return NextResponse.json({ message: 'No companies are due for a post yet.' })
  }

  // Trigger writer for each due company via internal fetch
  const adminKey = process.env.ADMIN_KEY
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://seo.trustmeentertainment.com'

  const results = await Promise.allSettled(
    due.map(companyId =>
      fetch(`${baseUrl}/api/admin/agents/run`, {
        method: 'POST',
        headers: { 'x-admin-key': adminKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'writer', company_id: companyId }),
      }).then(r => r.json())
    )
  )

  const succeeded = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length

  return NextResponse.json({
    triggered: due.length,
    succeeded,
    failed,
    message: `Ran writer for ${due.length} overdue companies. ${succeeded} succeeded${failed ? `, ${failed} failed` : ''}.`,
  })
}
