import { NextResponse } from 'next/server';
export async function GET() { return NextResponse.json({ ok: true, service: 'nova-pulse-dashboard', time: new Date().toISOString() }); }
