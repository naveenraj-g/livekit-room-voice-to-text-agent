import asyncio
import json
import logging
import os
from typing import Dict, AsyncGenerator
import aiohttp
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from livekit import agents, rtc
from livekit.agents import JobContext, WorkerOptions, cli
from livekit.agents.llm import ChatContext, ChatMessage
# We'll use the pre-built STT interfaces, but we might need to construct the plugin manually if we want to switch easily
from livekit.plugins import assemblyai
import time

# Load env
load_dotenv()

# Configuration
LIVEKIT_URL = os.getenv("LIVEKIT_URL")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")
TRANSCRIBE_PROVIDER = os.getenv("TRANSCRIBE_PROVIDER", "assemblyai")

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("transcriber-agent")

http_session: aiohttp.ClientSession = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global http_session
    http_session = aiohttp.ClientSession()
    yield
    await http_session.close()

app = FastAPI(lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # use the app url in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global state to hold room transcripts/queues
# roomId -> list of queues (one per connected SSE client)
transcript_queues: Dict[str, list[asyncio.Queue]] = {}

def get_stt_plugin():
    # if TRANSCRIBE_PROVIDER == "openai":
    #     return openai.STT()
    # elif TRANSCRIBE_PROVIDER == "assemblyai":
    #     return assemblyai.STT()
    # else:
        # Fallback or default
        return assemblyai.STT(http_session=http_session)

class TranscriberAgent:
    def __init__(self, ctx: JobContext, room_id: str):
        self.ctx = ctx
        self.room_id = room_id
        self.stt = get_stt_plugin()
        self.participants: Dict[str, rtc.Participant] = {}

    async def start(self):
        logger.info(f"Starting agent for room {self.room_id}")
        await self.ctx.connect(auto_subscribe=agents.AutoSubscribe.AUDIO_ONLY)
        
        # In a real agent workflow, we often listen to TrackSubscribed.
        # But for simple STT on all tracks, LiveKit Agents offers helpers.
        # We'll manually handle tracks to have fine control over identifying speakers.

        @self.ctx.room.on("track_subscribed")
        def on_track_subscribed(track: rtc.Track, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant):
            if track.kind == rtc.TrackKind.KIND_AUDIO:
                asyncio.create_task(self.transcribe_track(track, participant))

        # Handle participants already in the room
        for participant in self.ctx.room.remote_participants.values():
            for publication in participant.track_publications.values():
                if publication.track and publication.track.kind == rtc.TrackKind.KIND_AUDIO:
                    asyncio.create_task(self.transcribe_track(publication.track, participant))

    async def transcribe_track(self, track: rtc.AudioTrack, participant: rtc.RemoteParticipant):
        logger.info(f"Transcribing track {track.sid} from {participant.identity}")
        stream = self.stt.stream()
        
        async def audio_stream_feeder():
            async for frame in rtc.AudioStream(track):
                stream.push_frame(frame)
            stream.end_input()
        
        asyncio.create_task(audio_stream_feeder())

        async for event in stream:
            if event.type == agents.stt.SpeechEventType.FINAL_TRANSCRIPT:
                # We have a transcript
                text = event.alternatives[0].text
                if not text:
                    continue
                
                # Resolve name
                name = participant.name or participant.identity
                # Check metadata if name is missing or we want to prefer metadata
                if participant.metadata:
                    try:
                        md = json.loads(participant.metadata)
                        if "displayName" in md:
                            name = md["displayName"]
                    except:
                        pass

                msg = {
                    "roomId": self.room_id,
                    "timestamp": asyncio.get_event_loop().time(), # or isoformat
                    "participantIdentity": participant.identity,
                    "participantName": name,
                    "text": text
                }
                
                logger.info(f"Transcript: {name}: {text}")
                await self.broadcast_transcript(self.room_id, msg)

    async def broadcast_transcript(self, room_id: str, message: dict):
        if room_id in transcript_queues:
            for q in transcript_queues[room_id]:
                await q.put(message)

# Manager to effectively "dispatch" agents manually if needed, 
# BUT standard LiveKit Agents connects to the server and the server dispatch jobs to it.
# The user wants "/attach-transcriber" to ensure an agent is attached.
# LiveKit's standard way is that the Agent Worker connects to LiveKit, and LiveKit assigns it rooms.
# However, for this specific request "attach-transcriber", we can use the explicit Dispatch API from LiveKit Server SDK
# to request a job for this worker. Or simpler: The agent is just a client connecting to the room.
#
# The Prompt says: "Agent logic: Connect to LiveKit... Attach to specified roomId... "
# This implies the Python process acts more like a dynamic client or uses the Agent Dispatch framework.
# 
# Simplest Production approach with `livekit-agents`:
# Run a Worker. The /attach-transcriber API will use `livekit-api` (Server SDK) to create a Job for the worker,
# OR we can just have the Python /attach endpoint spawn a task that connects to the room as a participant.
# Given "No hardcoded room IDs", standard Agent Dispatch is best.
#
# However, the user wants a simple /attach-transcriber API on the Python side. 
# Implementing a "Worker" that listens to a specific job queue is the standard way.
# Let's try to map the User's "Attach" request to "Dispatching a Job" or "Direct Connection".
# Direct Connection is easier for a "minimal" app without complex dispatch rules.
# We will use a global dictionary of running agents.

running_agents: Dict[str, asyncio.Task] = {}

async def run_agent_for_room(room_id: str):
    # This function acts as the "Worker" for a specific room.
    # We will use the lower-level API or the Worker class in a non-standard way 
    # OR simpler: Just manually use `rtc.Room` and `STT` without the full `Worker` heavy lifting 
    # if we want absolute manual control via API.
    # BUT `livekit-agents` provides nice wrappers.
    # Let's use `rtc.Room` directly for maximum control given the API requirement.
    
    room = rtc.Room()
    # We need a token for the agent
    from livekit import api
    token_verifier = api.AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET) \
        .with_identity("transcriber-bot-" + room_id) \
        .with_name("Transcriber") \
        .with_grants(api.VideoGrants(room_join=True, room=room_id, can_publish=False, can_subscribe=True, hidden=True))
    
    token = token_verifier.to_jwt()

    async def room_task():
        try:
            await room.connect(LIVEKIT_URL, token)
            logger.info(f"Connected to room {room_id}")
            
            # Setup STT
            stt = get_stt_plugin()
            
            @room.on("track_subscribed")
            def on_track_subscribed(track, publication, participant):
                if track.kind == rtc.TrackKind.KIND_AUDIO:
                    asyncio.create_task(handle_audio_track(track, participant, stt, room_id))

            # Handle existing tracks
            for p in room.remote_participants.values():
                for pub in p.track_publications.values():
                    if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                        asyncio.create_task(handle_audio_track(pub.track, p, stt, room_id))
            
            @room.on("participant_disconnected")
            def on_participant_disconnected(participant: rtc.RemoteParticipant):
                if len(room.remote_participants) == 0:
                    logger.info(f"Room {room_id} is empty, disconnecting agent.")
                    asyncio.create_task(room.disconnect())

            # Keep alive until room is empty or closed
            while room.connection_state == rtc.ConnectionState.CONN_CONNECTED:
                await asyncio.sleep(1)
                
        except Exception as e:
            logger.error(f"Error in agent for room {room_id}: {e}")
        finally:
            await room.disconnect()
            if room_id in running_agents:
                del running_agents[room_id]

    task = asyncio.create_task(room_task())
    running_agents[room_id] = task
    return task

async def handle_audio_track(track: rtc.AudioTrack, participant: rtc.RemoteParticipant, stt, room_id):
    stream = stt.stream()
    
    async def feed_audio():
        # rtc.AudioStream needs to be closed properly?
        audio_stream = rtc.AudioStream(track)
        async for frame in audio_stream:
            stream.push_frame(frame.frame)
        stream.end_input()
        
    asyncio.create_task(feed_audio())
    
    async for event in stream:
        if event.type == agents.stt.SpeechEventType.FINAL_TRANSCRIPT:
            text = event.alternatives[0].text
            if text:
                 # Resolve name
                name = participant.name or participant.identity
                if participant.metadata:
                    try:
                        md = json.loads(participant.metadata)
                        if "displayName" in md:
                            name = md["displayName"]
                    except:
                        pass
                
                # Format Timestamp
                import datetime
                timestamp = datetime.datetime.now().isoformat()

                msg = {
                    "roomId": room_id,
                    "timestamp": timestamp,
                    "participantIdentity": participant.identity,
                    "participantName": name,
                    "text": text
                }
                
                logger.info(f"[{room_id}] {name}: {text}")
                
                # Broadcast
                if room_id in transcript_queues:
                    for q in transcript_queues[room_id]:
                        await q.put(msg)

@app.post("/attach-transcriber")
async def attach_transcriber(body: dict):
    room_id = body.get("roomId")
    if not room_id:
        raise HTTPException(status_code=400, detail="roomId required")
    
    if room_id in running_agents:
        return {"status": "already_running"}
    
    await run_agent_for_room(room_id)
    return {"status": "started"}

@app.get("/transcript-stream")
async def transcript_stream(roomId: str, request: Request):
    async def event_generator():
        q = asyncio.Queue()
        if roomId not in transcript_queues:
            transcript_queues[roomId] = []
        transcript_queues[roomId].append(q)
        
        try:
            while True:
                if await request.is_disconnected():
                    break
                # Wait for new transcript
                # Use a timeout to send keepalives if needed
                try:
                    data = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    # Send comment to keep connection alive
                    yield ": keepalive\n\n"
        finally:
            if roomId in transcript_queues:
                transcript_queues[roomId].remove(q)
                if not transcript_queues[roomId]:
                    del transcript_queues[roomId]

    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
