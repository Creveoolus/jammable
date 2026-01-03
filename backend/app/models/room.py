from pydantic import BaseModel
from typing import List, Optional

class Track(BaseModel):
    id: str
    url: str # Original URL
    stream_url: Optional[str] = None # Resolved URL from Cobalt
    title: str
    author: Optional[str] = None
    thumbnail: Optional[str] = None
    duration: Optional[float] = None
    added_by: str # Nickname
    source: Optional[str] = 'unknown'

class PlayerState(BaseModel):
    current_track_index: int = 0
    is_playing: bool = False
    timestamp: float = 0.0 # Last known timestamp
    last_updated: float = 0.0 # Server time when timestamp was updated
    start_time: float = 0.0
    loop_mode: str = 'off' # off, queue, track

class Room(BaseModel):
    id: str
    password_hash: Optional[str] = None
    admin_sid: Optional[str] = None # Socket ID of admin
    users: List[dict] = [] # List of {sid, nickname, last_seen}
    banned_user_ids: List[str] = []
    queue: List[Track] = []
    player: PlayerState = PlayerState()
    created_at: float
