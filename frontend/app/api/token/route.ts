import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { roomId, name } = await req.json();

  if (!roomId || !name) {
    return NextResponse.json({ error: 'Missing roomId or name' }, { status: 400 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  // Generate identity (random for now, or could use name-random)
  const identity = `${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Math.random().toString(36).substring(7)}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity: identity,
    name: name,
    metadata: JSON.stringify({ displayName: name }),
  });

  at.addGrant({
    roomJoin: true,
    room: roomId,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();

  return NextResponse.json({ token, identity });
}
