import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { roomId } = await req.json();
  const pyAgentUrl = process.env.NEXT_PUBLIC_PY_AGENT_URL || 'http://localhost:8000';

  if (!roomId) {
    return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
  }

  try {
    const res = await fetch(`${pyAgentUrl}/attach-transcriber`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomId }),
    });

    if (!res.ok) {
        console.error("Failed to start transcriber", await res.text());
        return NextResponse.json({ error: 'Failed' }, { status: res.status });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error calling transcriber agent", error);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}
