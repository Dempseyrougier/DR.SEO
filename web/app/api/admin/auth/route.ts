import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { key } = await req.json()
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey || key !== adminKey) {
    // Delay on failure to slow brute-force attempts
    await new Promise(resolve => setTimeout(resolve, 1500))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
