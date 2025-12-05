'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  VideoConference,
  GridLayout,
  ParticipantTile,
  useTracks,
  RoomName,
  ControlBar,
  useRoomContext,
  ConnectionStateToast,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { RoomEvent, Track } from 'livekit-client';
import { useRouter } from 'next/navigation';

interface RoomProps {
  roomId: string;
  name: string;
  onLeave: () => void;
}

export default function Room({ roomId, name, onLeave }: RoomProps) {
  const [token, setToken] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId, name }),
        });
        const data = await resp.json();
        setToken(data.token);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [roomId, name]);

  if (!token) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
        Getting token...
      </div>
    );
  }

  return (
    <LiveKitRoom
      video={true}
      audio={true}
      token={token}
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
      data-lk-theme="default"
      style={{ height: '100vh' }}
      onDisconnected={onLeave}
      className="bg-gray-950"
    >
      <RoomUI roomId={roomId} onLeave={onLeave} />
    </LiveKitRoom>
  );
}

function RoomUI({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const [transcripts, setTranscripts] = useState<Array<{name: string, text: string, timestamp: string}>>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  
  // Start Transcriber
  useEffect(() => {
    fetch('/api/start-transcriber', {
      method: 'POST',
      body: JSON.stringify({ roomId }),
      headers: { 'Content-Type': 'application/json' }
    }).catch(console.error);
  }, [roomId]);

  // SSE Subscription
  useEffect(() => {
    const pyUrl = process.env.NEXT_PUBLIC_PY_AGENT_URL || 'http://localhost:8000';
    const eventSource = new EventSource(`${pyUrl}/transcript-stream?roomId=${roomId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data && data.text) {
            // Format timestamp HH:MM from ISO or raw
            let timeStr = "";
            try {
                const date = new Date(data.timestamp);
                timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            } catch {
                timeStr = "";
            }

            setTranscripts(prev => [...prev, {
                timestamp: timeStr,
                name: data.participantName,
                text: data.text
            }]);
        }
      } catch (e) {
        // ignore keepalives or errors
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE Error", err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [roomId]);

  // Auto-scroll
  useEffect(() => {
    if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transcripts]);

  // Get tracks for grid
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  return (
    <div className="flex flex-col h-full w-full">
      {/* Top Bar */}
      <div className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
            <span className="font-bold text-white">Room:</span>
            <span className="text-indigo-400 font-mono">{roomId}</span>
        </div>
        <button 
            onClick={() => { onLeave() }}
            className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm transition-colors"
        >
            Leave
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Video Grid */}
        <div className="flex-1 bg-gray-950 relative p-4">
            <GridLayout tracks={tracks}>
                <ParticipantTile />
            </GridLayout>
            <RoomAudioRenderer />
            <ConnectionStateToast />
            
            {/* Controls at bottom center of video area */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                <ControlBar variation="minimal" controls={{ screenShare: false, chat: false }} />
            </div>
        </div>

        {/* Right: Transcript Panel */}
        <div className="w-80 md:w-96 bg-gray-900 border-l border-gray-800 flex flex-col">
            <div className="p-4 border-b border-gray-800 font-semibold text-gray-200">
                Live Transcript
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {transcripts.length === 0 && (
                    <div className="text-gray-500 text-sm text-center italic mt-10">
                        Waiting for speech...
                    </div>
                )}
                {transcripts.map((t, i) => (
                    <div key={i} className="flex flex-col start">
                        <div className="flex items-baseline gap-2">
                            <span className="text-xs text-gray-500 font-mono">[{t.timestamp}]</span>
                            <span className="text-sm font-bold text-indigo-300">{t.name}</span>
                        </div>
                        <p className="text-gray-300 text-sm pl-1">{t.text}</p>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
      </div>
    </div>
  );
}
