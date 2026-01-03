import json
import uuid
import time
from typing import Optional
from app.database import redis_client
from app.models.room import Room, Track, PlayerState
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

ROOM_TTL = 3600 * 10 # 10 hours

async def create_room(password: str = None, creator_sid: str = None, creator_nickname: str = "Admin") -> Room:
    room_id = str(uuid.uuid4())[:8]
    password_hash = pwd_context.hash(password) if password else None
    
    # Initialize with creator in users if provided
    users = []
    if creator_sid:
        users.append({"sid": creator_sid, "nickname": creator_nickname})

    room = Room(
        id=room_id,
        password_hash=password_hash,
        admin_sid=creator_sid,
        users=users,
        created_at=time.time()
    )
    
    await save_room(room)
    return room

async def get_room(room_id: str) -> Optional[Room]:
    try:
        data = await redis_client.get(f"room:{room_id}")
        if not data:
            return None
        return Room.model_validate_json(data)
    except Exception as e:
        print(f"Error loading room {room_id}: {e}")
        return None

async def save_room(room: Room):
    await redis_client.set(f"room:{room.id}", room.model_dump_json(), ex=ROOM_TTL)

async def verify_password(room: Room, password: str) -> bool:
    if not room.password_hash:
        return True
    if not password:
        return False
    return pwd_context.verify(password, room.password_hash)

async def add_user(room_id: str, sid: str, nickname: str, user_id: str = None):
    room = await get_room(room_id)
    if room:
        # Check if user already exists by user_id
        existing_user = None
        if user_id:
            for u in room.users:
                if u.get('user_id') == user_id:
                    existing_user = u
                    break
        
        if existing_user:
            # Update existing user's SID
            old_sid = existing_user['sid']
            existing_user['sid'] = sid
            existing_user['nickname'] = nickname # Update nickname if changed
            
            # If they were admin, update admin_sid
            if room.admin_sid == old_sid:
                room.admin_sid = sid
                
            await save_room(room)
            return room

        # Check if user already exists by SID (fallback)
        if not any(u['sid'] == sid for u in room.users):
            room.users.append({"sid": sid, "nickname": nickname, "user_id": user_id})
            # If no admin, make this user admin
            if not room.admin_sid:
                room.admin_sid = sid
            await save_room(room)
    return room

async def remove_user(room_id: str, sid: str):
    room = await get_room(room_id)
    if room:
        room.users = [u for u in room.users if u['sid'] != sid]
        
        # If admin left, assign new admin
        if room.admin_sid == sid:
            if room.users:
                room.admin_sid = room.users[0]['sid']
            else:
                room.admin_sid = None # Room empty
        
        await save_room(room)
    return room

async def update_player_state(room_id: str, state: PlayerState):
    room = await get_room(room_id)
    if room:
        room.player = state
        await save_room(room)
    return room

async def reorder_queue(room_id: str, new_queue: list[Track]):
    room = await get_room(room_id)
    if room:
        room.queue = new_queue
        await save_room(room)
    return room
