import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../../lib/supabase'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

    const daysPerPost = Math.floor(7 / (company.posts_per_week || 1))
    if (daysSinceLast >= daysPerPost) due.push(company.id)
  }

  if (!due.length) {
    return NextResponse.json({ message: 'No companies are due for a post.' })
  }

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
