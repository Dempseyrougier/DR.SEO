import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { key } = await req.json()
  const adminKey = process.env.ADMIN_KEY
  if (!adminKey || key !== adminKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
