import logging
from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import httpx
import socketio
import time
import uuid
from app.services import room as room_service
from app.services import media
from app.models.room import Track, PlayerState, Room
import random

import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global mapping for SID -> Room ID to handle disconnects efficiently
sid_room_map = {}

app = FastAPI()

# CORS Configuration
origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")

class CORSStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Access-Control-Allow-Origin"] = origins[0] if origins else "*"
        return response

app.mount("/static", CORSStaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins=origins if origins != ["*"] else "*")
socket_app = socketio.ASGIApp(sio, app)

# REST API
@app.post("/api/create_room")
async def create_room_endpoint(password: str = None, nickname: str = "Admin"):
    # We create a room but without a SID yet. 
    # The creator will join via socket immediately after.
    # We pass None as sid for now.
    r = await room_service.create_room(password=password, creator_nickname=nickname)
    return {"room_id": r.id}

@app.get("/api/room/{room_id}")
async def check_room(room_id: str):
    r = await room_service.get_room(room_id)
    if not r:
        raise HTTPException(status_code=404, detail="Room not found")
    return {"has_password": r.password_hash is not None}

@app.get("/api/proxy_media")
async def proxy_media(url: str):
    """
    Proxy media content to bypass CORS restrictions.
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, follow_redirects=True)
            return Response(
                content=response.content,
                media_type=response.headers.get("content-type"),
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "public, max-age=31536000"
                }
            )
    except Exception as e:
        logger.error(f"Proxy error: {e}")
        return Response(status_code=500)

# Socket Events
@sio.event
async def connect(sid, environ):
    logger.info(f"Client {sid} connected")

@sio.event
async def disconnect(sid):
    try:
        logger.info(f"Client {sid} disconnected")
        room_id = sid_room_map.pop(sid, None)
        if room_id:
            logger.info(f"Removing user {sid} from room {room_id}")
            room = await room_service.remove_user(room_id, sid)
            if room:
                await sio.emit("room_state", {"state": room.model_dump(), "server_time": time.time()}, room=room_id)
    except Exception as e:
        logger.error(f"Error in disconnect: {e}", exc_info=True)

@sio.event
async def join_room(sid, data):
    try:
        room_id = data.get("room_id")
        nickname = data.get("nickname", "Guest")
        password = data.get("password")
        user_id = data.get("user_id")
        
        logger.info(f"Join request: sid={sid}, room={room_id}, nick={nickname}")
        
        room = await room_service.get_room(room_id)
        if not room:
            logger.warning(f"Room {room_id} not found for join request")
            await sio.emit("error", {"message": "Room not found"}, to=sid)
            return
        
        if room.password_hash and not await room_service.verify_password(room, password):
            logger.warning(f"Invalid password for room {room_id}")
            await sio.emit("error", {"message": "Invalid password"}, to=sid)
            return

        # Check ban status
        if user_id and user_id in room.banned_user_ids:
            logger.warning(f"User {user_id} is banned from room {room_id}")
            await sio.emit("error", {"message": "You are banned from this room"}, to=sid)
            return

        room = await room_service.add_user(room_id, sid, nickname, user_id)
        sid_room_map[sid] = room_id
        
        # Initialize last_seen
        for u in room.users:
            if u['sid'] == sid:
                u['last_seen'] = time.time()
                break
                
        await sio.enter_room(sid, room_id)
        logger.info(f"User {nickname} joined room {room_id}")
        
        # Emit state directly to the joining user to ensure they receive it
        await sio.emit("room_state", {"state": room.model_dump(), "server_time": time.time()}, to=sid)
        
        # Broadcast to others in the room
        await sio.emit("room_state", {"state": room.model_dump(), "server_time": time.time()}, room=room_id, skip_sid=sid)
        
        # Notify that a user joined (so Host can sync)
        await sio.emit("user_joined", {"nickname": nickname, "sid": sid}, room=room_id, skip_sid=sid)
    except Exception as e:
        logger.error(f"Error in join_room: {e}", exc_info=True)
        await sio.emit("error", {"message": "Internal server error during join"}, to=sid)

@sio.event
async def add_track(sid, data):
    room_id = data.get("room_id")
    url = data.get("url")
    
    if not url:
        return

    # Notify processing
    await sio.emit("notification", {"message": "Processing URL..."}, to=sid)

    media_info = await media.resolve_media(url)
    if not media_info:
        await sio.emit("error", {"message": "Could not resolve URL"}, to=sid)
        return
        
    room = await room_service.get_room(room_id)
    if not room:
        return

    adder_name = "Unknown"
    for u in room.users:
        if u['sid'] == sid:
            adder_name = u['nickname']
            break
            
    track = Track(
        id=str(uuid.uuid4()),
        url=url,
        stream_url=media_info["stream_url"],
        title=media_info["title"],
        author=media_info.get("author"),
        thumbnail=media_info["thumbnail"],
        added_by=adder_name
    )
    
    room.queue.append(track)
    await room_service.save_room(room)
    # Emit only queue update
    await sio.emit("queue_update", {"queue": [t.model_dump() for t in room.queue], "server_time": time.time()}, room=room_id)
    # If queue was empty and we added first track, we might want to auto-play or just let it be.
    # But user asked to separate sockets.
    # If we need to update player state (e.g. current_track_index was out of bounds), we should emit player_update too.
    # Checking if we need to reset player index?
    if len(room.queue) == 1:
        # First track added. Ensure index is 0.
        room.player.current_track_index = 0
        await room_service.save_room(room)
        await sio.emit("player_update", {"player": room.player.model_dump(), "server_time": time.time()}, room=room_id)

@sio.event
async def remove_track(sid, data):
    room_id = data.get("room_id")
    track_id = data.get("track_id")
    
    room = await room_service.get_room(room_id)
    if not room: return
    
    # Check admin or added_by?
    if room.admin_sid != sid:
         # Allow user to remove their own track
         track = next((t for t in room.queue if t.id == track_id), None)
         if not track: return
         
         # Find user nickname
         user = next((u for u in room.users if u['sid'] == sid), None)
         if not user or track.added_by != user['nickname']:
             return # Not admin and not owner of track

    # Check if we are removing the currently playing track
    current_index = room.player.current_track_index
    removed_index = -1
    for i, t in enumerate(room.queue):
        if t.id == track_id:
            removed_index = i
            break
            
    room.queue = [t for t in room.queue if t.id != track_id]
    
    # Adjust current_track_index if necessary
    if removed_index != -1:
        if removed_index < current_index:
            room.player.current_track_index = max(0, current_index - 1)
        elif removed_index == current_index:
            # We removed the playing track. 
            # Logic: Play the next one (which is now at the same index) or stop if empty
            if not room.queue:
                room.player.is_playing = False
                room.player.current_track_index = 0
            elif current_index >= len(room.queue):
                room.player.current_track_index = 0 # Loop back or stop
            # If we removed current, we probably should notify player update too
            # For now, let's keep index valid.

    await room_service.save_room(room)
    await sio.emit("queue_update", {"queue": [t.model_dump() for t in room.queue]}, room=room_id)
    # Also emit player update in case index changed
    await sio.emit("player_update", {"player": room.player.model_dump(), "server_time": time.time()}, room=room_id)

@sio.event
async def reorder_queue(sid, data):
    room_id = data.get("room_id")
    new_queue_ids = data.get("queue_ids") # List of track IDs
    
    room = await room_service.get_room(room_id)
    if not room: return
    
    # Get current playing track ID
    current_track_id = None
    if 0 <= room.player.current_track_index < len(room.queue):
        current_track_id = room.queue[room.player.current_track_index].id

    # Reorder based on IDs
    id_map = {t.id: t for t in room.queue}
    new_queue = []
    for tid in new_queue_ids:
        if tid in id_map:
            new_queue.append(id_map[tid])
            
    room.queue = new_queue
    
    # Find new index of current track
    if current_track_id:
        new_index = -1
        for i, t in enumerate(room.queue):
            if t.id == current_track_id:
                new_index = i
                break
        if new_index != -1:
            room.player.current_track_index = new_index
        else:
            # Track disappeared? Reset
            room.player.current_track_index = 0
            room.player.is_playing = False
            
    await room_service.save_room(room)
    # Send queue update with current_track_index to avoid full player update (which causes jumps)
    await sio.emit("queue_update", {
        "queue": [t.model_dump() for t in room.queue], 
        "current_track_index": room.player.current_track_index,
        "server_time": time.time()
    }, room=room_id)

@sio.event
async def shuffle_queue(sid, data):
    room_id = data.get("room_id")
    
    room = await room_service.get_room(room_id)
    if not room: return
    
    if not room.queue:
        return

    # Strategy: Keep current track playing, shuffle the rest.
    current_index = room.player.current_track_index
    if 0 <= current_index < len(room.queue):
        current_track = room.queue[current_index]
        other_tracks = room.queue[:current_index] + room.queue[current_index+1:]
        random.shuffle(other_tracks)
        # Put current track at index 0 and rest shuffled after it.
        room.queue = [current_track] + other_tracks
        room.player.current_track_index = 0
    else:
        # Just shuffle all
        random.shuffle(room.queue)
        room.player.current_track_index = 0
        
    await room_service.save_room(room)
    # Send queue update with current_track_index
    await sio.emit("queue_update", {
        "queue": [t.model_dump() for t in room.queue],
        "current_track_index": room.player.current_track_index,
        "server_time": time.time()
    }, room=room_id)

@sio.event
async def play_track(sid, data):
    room_id = data.get("room_id")
    track_id = data.get("track_id")
    
    room = await room_service.get_room(room_id)
    if not room: return
    
    # Find index
    new_index = -1
    for i, t in enumerate(room.queue):
        if t.id == track_id:
            new_index = i
            break
            
    if new_index != -1:
        room.player.current_track_index = new_index
        room.player.is_playing = True
        room.player.timestamp = 0
        room.player.start_time = time.time()
        room.player.last_updated = time.time()
        
        await room_service.save_room(room)
        await sio.emit("player_update", {"player": room.player.model_dump(), "server_time": time.time()}, room=room_id)

@sio.event
async def request_sync(sid, data):
    room_id = data.get("room_id")
    room = await room_service.get_room(room_id)
    if not room or not room.admin_sid: return
    
    # Ask host for state
    await sio.emit("get_host_state", {"requester_sid": sid}, to=room.admin_sid)

@sio.event
async def host_state_response(sid, data):
    room_id = data.get("room_id")
    requester_sid = data.get("requester_sid")
    timestamp = data.get("timestamp")
    is_playing = data.get("is_playing")
    
    room = await room_service.get_room(room_id)
    if not room: return
    
    if room.admin_sid != sid: return

    # Update server state to match host
    room.player.timestamp = timestamp
    room.player.is_playing = is_playing
    if is_playing:
        room.player.start_time = time.time() - timestamp
    room.player.last_updated = time.time()
    await room_service.save_room(room)
    
    # Send to requester
    await sio.emit("sync_target", {
        "timestamp": timestamp,
        "is_playing": is_playing,
        "server_time": time.time()
    }, to=requester_sid)

@sio.event
async def host_sync(sid, data):
    """
    Host sends current playback state.
    Server updates state and broadcasts to clients.
    Also handles zombie user cleanup.
    """
    room_id = data.get("room_id")
    timestamp = data.get("timestamp")
    is_playing = data.get("is_playing")
    
    room = await room_service.get_room(room_id)
    if not room: return
    
    # Only admin (host) can drive sync
    if room.admin_sid != sid:
        return

    # Race condition fix: If player state was updated recently (e.g. by a seek/skip),
    # ignore host_sync for a short window to allow Host to receive the update.
    # otherwise Host might overwrite the seek with old timestamp.
    if time.time() - room.player.last_updated < 1.5:
        return

    # Update player state
    if timestamp is not None:
        room.player.timestamp = timestamp
        if is_playing is not None:
            room.player.is_playing = is_playing
            if is_playing:
                # Recalculate start_time so it matches current server time
                room.player.start_time = time.time() - timestamp
        
        room.player.last_updated = time.time()
        await room_service.save_room(room)
        
        # Broadcast sync pulse to non-admin users
        # We include server_time so clients can calculate drift
        await sio.emit("sync_pulse", {
            "timestamp": timestamp,
            "is_playing": room.player.is_playing,
            "server_time": time.time()
        }, room=room_id, skip_sid=sid)

    # Zombie Cleanup Logic
    # Always emit ping for zombie check to keep users alive
    await sio.emit("ping", {"room_id": room_id}, room=room_id, skip_sid=sid)

    # Check for users who haven't ponged in X seconds (e.g. 15s)
    current_time = time.time()
    active_users = []
    removed_users = False
    
    for u in room.users:
        last_seen = u.get('last_seen', current_time) # Default to now if missing
        if current_time - last_seen > 15 and u['sid'] != room.admin_sid:
            # User is a zombie
            logger.info(f"Removing zombie user {u['nickname']} ({u['sid']})")
            removed_users = True
            # Don't add to active_users
        else:
            active_users.append(u)
            
    if removed_users:
        room.users = active_users
        await room_service.save_room(room)
        await sio.emit("room_state", {"state": room.model_dump(), "server_time": time.time()}, room=room_id)

@sio.event
async def client_pong(sid, data):
    room_id = data.get("room_id")
    room = await room_service.get_room(room_id)
    if not room: return
    
    updated = False
    for u in room.users:
        if u['sid'] == sid:
            u['last_seen'] = time.time()
            updated = True
            break
            
    if updated:
        await room_service.save_room(room)

@sio.event
async def player_control(sid, data):
    # data: {room_id, action: "play"|"pause"|"seek"|"next"|"prev", timestamp, track_index}
    room_id = data.get("room_id")
    action = data.get("action")
    timestamp = data.get("timestamp", 0)
    
    room = await room_service.get_room(room_id)
    if not room: return
    
    state = room.player
    state.last_updated = time.time()
    
    if action == "play":
        state.is_playing = True
        state.timestamp = timestamp
        state.start_time = time.time() - timestamp
        # Support for direct index play
        if "index" in data:
            state.current_track_index = data["index"]
    elif action == "pause":
        state.is_playing = False
        state.timestamp = timestamp
    elif action == "seek":
        state.timestamp = timestamp
        if state.is_playing:
            state.start_time = time.time() - timestamp
    elif action == "loop":
        state.loop_mode = data.get("loop_mode", "off")
    elif action == "next":
        # Check loop mode logic
        # If 'track' mode, next means replay current track unless forced?
        # Usually "Next" button forces next track, but "onEnded" calls this too.
        # We need to distinguish manual next vs auto next, or just let "Next" button skip loop.
        # But the user complaint is about loop not working.
        # If the frontend sends "next" on track end, and mode is 'track', we should restart.
        # But if user CLICKS next, they probably want the next track.
        # Frontend can differentiate by action type or a flag, but for now let's assume 'next' respects loop
        # ONLY if it was triggered by auto-play (which we can't easily distinguish without a flag).
        # HOWEVER, standard behavior in many players: Next button skips track even in loop 1 mode.
        # The issue is the frontend calls 'next' onEnded.
        # Let's add a 'reason' field or 'auto' flag, OR simpler:
        # If frontend handles onEnded, it should request 'restart' if loop is track.
        # But I want to fix this on backend for robustness.
        
        # Let's change the logic: 'next' will ALWAYS go to next track,
        # UNLESS we add a specific 'track_end' action or similar.
        # Actually, user said "when repetition is set to this track, it puts it at 0:00".
        # This implies my previous frontend change `seek(0); play()` failed.
        # Let's implement a 'restart' action for clarity, or handle 'loop_track' logic here if we want to change 'next' behavior.
        
        # Better: Frontend sends 'auto_next' on finish?
        # Or simply:
        is_auto = data.get("auto", False)
        
        if is_auto and state.loop_mode == 'track':
             state.timestamp = 0
             state.is_playing = True
             state.start_time = time.time()
        elif state.current_track_index < len(room.queue) - 1:
            state.current_track_index += 1
            state.timestamp = 0
            state.is_playing = True
            state.start_time = time.time()
        else:
            # End of queue logic
            if state.loop_mode == 'queue':
                state.current_track_index = 0
                state.timestamp = 0
                state.is_playing = True
                state.start_time = time.time()
            else:
                # Stop if not looping queue
                # If 'track' mode and we are at end and user clicked next manually?
                # If manual next and track loop, we go to next (which is none) -> stop.
                state.is_playing = False
                state.timestamp = 0
    elif action == "prev":
        if state.current_track_index > 0:
            state.current_track_index -= 1
            state.timestamp = 0
            state.is_playing = True
            state.start_time = time.time()
            
    room.player = state
    await room_service.save_room(room)
    await sio.emit("player_update", {"player": room.player.model_dump(), "server_time": time.time()}, room=room_id)

@sio.event
async def kick_user(sid, data):
    room_id = data.get("room_id")
    target_sid = data.get("target_sid")
    
    room = await room_service.get_room(room_id)
    if not room: return
    
    if room.admin_sid != sid:
        return # Only admin
    
    # Identify user_id of the target
    target_user = next((u for u in room.users if u['sid'] == target_sid), None)
    if target_user and target_user.get('user_id'):
        room.banned_user_ids.append(target_user['user_id'])
        await room_service.save_room(room)
        
    await room_service.remove_user(room_id, target_sid)
    # Emit kick event to target
    await sio.emit("kicked", {}, to=target_sid)
    # Update room
    await sio.emit("room_state", {"state": room.model_dump(), "server_time": time.time()}, room=room_id)

