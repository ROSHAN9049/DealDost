import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const secret = process.env.INGEST_SECRET;
  if (secret && req.headers.get('x-ingest-secret') !== secret) return NextResponse.json({error:'unauthorized'}, {status:401});
  const body = await req.json();
  if (!body?.mint || !['buy','sell'].includes(body?.side) || typeof body?.solAmount !== 'number') {
    return NextResponse.json({error:'mint, side and numeric solAmount are required'}, {status:400});
  }
  // Forward this normalized event to your scanner worker. The dashboard never holds service-role credentials.
  const target = process.env.SCANNER_INGEST_URL;
  if (!target) return NextResponse.json({accepted:true, forwarded:false, message:'Configure SCANNER_INGEST_URL'});
  const r = await fetch(target, {method:'POST', headers:{'content-type':'application/json','x-ingest-secret':secret ?? ''}, body:JSON.stringify(body)});
  return NextResponse.json({accepted:r.ok, forwarded:true}, {status:r.ok ? 202 : 502});
}
