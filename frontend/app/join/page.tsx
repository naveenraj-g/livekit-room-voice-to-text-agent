'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Room from '@/components/Room';

function JoinContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [shouldJoin, setShouldJoin] = useState(false);

  useEffect(() => {
    const r = searchParams.get('roomId');
    const n = searchParams.get('name');
    if (r) setRoomId(r);
    if (n) setName(n);
    if (r && n) {
      setShouldJoin(true);
    }
  }, [searchParams]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId && name) {
      router.push(`/join?roomId=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name)}`);
    }
  };

  if (shouldJoin) {
    return <Room roomId={roomId} name={name} onLeave={() => {
        router.push('/join'); 
        setShouldJoin(false);
    }} />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4 font-sans text-white">
      <div className="w-full max-w-md space-y-8 rounded-xl bg-gray-900 p-8 shadow-2xl border border-gray-800">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-white mb-2">LiveKit Transcriber</h2>
          <p className="text-gray-400">Enter a room to start speaking</p>
        </div>
        
        <form className="mt-8 space-y-6" onSubmit={handleJoin}>
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-300">
                Display Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm transition duration-200"
                placeholder="Alice"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="roomId" className="block text-sm font-medium text-gray-300">
                Room ID
              </label>
              <input
                id="roomId"
                name="roomId"
                type="text"
                required
                className="mt-1 block w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm transition duration-200"
                placeholder="my-daily-standup"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              className="group relative flex w-full justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all duration-200 shadow-lg hover:shadow-indigo-500/30"
            >
              Join Room
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function JoinPage() {
    return (
        <Suspense fallback={<div className="text-white">Loading...</div>}>
            <JoinContent />
        </Suspense>
    );
}
