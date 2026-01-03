import { useEffect, useState, useRef } from 'react';
import { useParams, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Play, Pause, SkipForward, SkipBack, Trash2, GripVertical, Crown, LogOut, Globe, Music, Lock, Share2, Copy, Check, Volume2, VolumeX, Shuffle, RefreshCw, Repeat, Repeat1 } from 'lucide-react';
import { FaYoutube, FaSpotify, FaSoundcloud } from 'react-icons/fa';
import Hls from 'hls.js';
import Modal from '../components/Modal';

const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8000`;

interface Track {
    id: string;
    title: string;
    author?: string;
    url: string;
    stream_url?: string;
    thumbnail?: string;
    added_by: string;
    source?: string;
}
interface PlayerState {
        current_track_index: number;
        is_playing: boolean;
        timestamp: number;
        start_time: number;
        last_updated: number;
        loop_mode: 'off' | 'queue' | 'track';
    }
interface User {
    sid: string;
    nickname: string;
}
interface RoomState {
    id: string;
    admin_sid: string;
    users: User[];
    queue: Track[];
    player: PlayerState;
    server_time?: number;
    receivedAt?: number;
}

function SortableItem({ track, isAdmin, onDelete, currentId, myNickname, queueIndex, onPlay }: any) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: track.id });
    const style = { transform: CSS.Transform.toString(transform), transition };
    const isPlaying = track.id === currentId;
    const canDelete = isAdmin || track.added_by === myNickname;

    const getIcon = () => {
        switch(track.source) {
            case 'youtube': return <FaYoutube className="text-red-500" size={20} />;
            case 'spotify': return <FaSpotify className="text-green-500" size={20} />;
            case 'soundcloud': return <FaSoundcloud className="text-orange-500" size={20} />;
            default: return null;
        }
    };

    return (
        <div ref={setNodeRef} style={style} className={`flex items-center gap-3 bg-slate-800 p-3 rounded-xl mb-2 border border-slate-700 ${isPlaying ? 'border-blue-500 shadow-lg shadow-blue-500/10' : 'hover:border-slate-600'}`}>
            <div {...attributes} {...listeners} className="cursor-grab text-slate-500 hover:text-white transition flex items-center gap-2">
                <GripVertical size={20} />
                <span className="font-mono text-xs font-bold w-6 text-center">{queueIndex + 1}</span>
            </div>
            <div className="flex-shrink-0">
                {getIcon()}
            </div>
            <img src={track.thumbnail || 'https://placehold.co/600x400?text=No+Image'} alt="art" className="w-12 h-12 rounded-lg object-cover" />
            <div className="flex-1 min-w-0">
                <p className={`font-bold truncate text-sm ${isPlaying ? 'text-blue-400' : 'text-white'}`}>{track.title}</p>
                {track.author && <p className="text-xs text-slate-300 truncate">{track.author}</p>}
                <p className="text-xs text-slate-400">Added by {track.added_by}</p>
            </div>
            
            <button onClick={() => onPlay(track.id)} className="text-blue-400 hover:text-blue-300 p-2 hover:bg-slate-700 rounded-lg transition" title="Play Now">
                <Play size={18} />
            </button>
            
            {canDelete && (
                <button onClick={() => onDelete(track.id)} className="text-red-500 hover:text-red-400 p-2 hover:bg-slate-700 rounded-lg transition">
                    <Trash2 size={18} />
                </button>
            )}
        </div>
    );
}

const getUserId = () => {
    let uid = localStorage.getItem('jamable_user_id');
    if (!uid) {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            uid = crypto.randomUUID();
        } else {
            // Fallback for environments where crypto.randomUUID is not available
            uid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }
        localStorage.setItem('jamable_user_id', uid);
    }
    return uid;
};

const Room = () => {
    const { id: roomId } = useParams();
    const { state } = useLocation(); 
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    
    const [socket, setSocket] = useState<Socket | null>(null);
    const [roomState, setRoomState] = useState<RoomState | null>(null);
    const roomStateRef = useRef<RoomState | null>(null);
    useEffect(() => { roomStateRef.current = roomState; }, [roomState]);

    const [inputUrl, setInputUrl] = useState('');
    const audioRef = useRef<HTMLAudioElement>(null);
    const coverRef = useRef<HTMLDivElement>(null);
    const hlsRef = useRef<Hls | null>(null);

    const isAdmin = roomState?.admin_sid === socket?.id;
    const currentTrack = roomState?.player ? roomState.queue[roomState.player.current_track_index] : undefined;
    
    // Volume & Time
    const [volume, setVolume] = useState(parseFloat(localStorage.getItem('jamable_volume') || '1'));
    const [lastVolume, setLastVolume] = useState(1);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
         if (audioRef.current) {
             audioRef.current.volume = volume;
         }
    }, []); // Initial volume set

    const formatTime = (seconds: number) => {
        if (!seconds || isNaN(seconds)) return "0:00";
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
            localStorage.setItem('jamable_volume', volume.toString());
        }
    }, [volume]);

    // Modals
    const [isExitOpen, setExitOpen] = useState(false);
    const [isPasswordOpen, setPasswordOpen] = useState(false);
    const [isShareOpen, setShareOpen] = useState(false);
    const [isJoinOpen, setJoinOpen] = useState(false);
    
    // Password Logic
    const [password, setPassword] = useState(state?.password || searchParams.get('pwd') || '');
    const [passwordInput, setPasswordInput] = useState('');
    const [hasPasswordProtection, setHasPasswordProtection] = useState(false);
    
    // Share Logic
    const [includePwdInShare, setIncludePwdInShare] = useState(false);
    const [copied, setCopied] = useState(false);

    const [nickname, setNickname] = useState(state?.nickname || localStorage.getItem('jamable_nickname') || '');

    useEffect(() => {
        // Check if room has password
        fetch(`${API_URL}/api/room/${roomId}`)
            .then(res => res.json())
            .then(data => {
                setHasPasswordProtection(data.has_password);
                if (data.has_password && !password) {
                    // If no password provided yet, ensure we will ask for it
                    // The Join Modal will handle this if nickname is missing, 
                    // or Password Modal if nickname exists but password failed.
                }
            })
            .catch(err => console.error("Failed to check room info:", err));
    }, [roomId]);

    useEffect(() => {
        if (!nickname) {
            setJoinOpen(true);
        }
    }, [nickname]);

    const handleJoinSubmit = (name: string, pwd?: string) => {
        setNickname(name);
        localStorage.setItem('jamable_nickname', name);
        if (pwd) setPassword(pwd);
        setJoinOpen(false);
    };

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    useEffect(() => {
        if (!nickname) return; // Wait for nickname
        
        const s = io(API_URL);
        setSocket(s);

        s.on('room_state', (data: any) => {
            console.log('Room State Updated:', data);
            const state = data.state || data; 
            const serverTime = data.server_time;
            setRoomState({ ...state, server_time: serverTime, receivedAt: Date.now() });
        });

        s.on('queue_update', (data: { queue: Track[], current_track_index?: number }) => {
            console.log('Queue Updated');
            setRoomState(prev => prev ? { 
                ...prev, 
                queue: data.queue, 
                player: data.current_track_index !== undefined ? {
                    ...prev.player,
                    current_track_index: data.current_track_index
                } : prev.player
            } : null);
        });


        s.on('get_host_state', (data: { requester_sid: string }) => {
            if (!audioRef.current) return;
            console.log('Sending host state to requester:', data.requester_sid);
            s.emit('host_state_response', {
                room_id: roomId,
                requester_sid: data.requester_sid,
                timestamp: audioRef.current.currentTime,
                is_playing: !audioRef.current.paused
            });
        });

        s.on('sync_target', (data: { timestamp: number, is_playing: boolean, server_time: number }) => {
            console.log('Received sync target:', data);
            setRoomState(prev => {
                if (!prev) return null;
                const newPlayer = { ...prev.player, timestamp: data.timestamp, is_playing: data.is_playing };
                return {
                    ...prev,
                    player: newPlayer,
                    server_time: data.server_time,
                    receivedAt: Date.now()
                };
            });
            if (audioRef.current) {
                audioRef.current.currentTime = data.timestamp;
                if (data.is_playing) {
                    audioRef.current.play().catch(e => console.error(e));
                } else {
                    audioRef.current.pause();
                }
            }
        });

        s.on('ping', () => {
             s.emit('client_pong', { room_id: roomId });
        });

        s.on('sync_pulse', (data: { timestamp: number, is_playing: boolean, server_time: number }) => {
            setRoomState(prev => {
                if (!prev) return null;
                // Check if I am admin using the socket id
                if (prev.admin_sid === s.id) return prev;

                // Emit Pong
                s.emit('client_pong', { room_id: roomId });

                const newPlayer = { ...prev.player, timestamp: data.timestamp, is_playing: data.is_playing };
                return {
                    ...prev,
                    player: newPlayer,
                    server_time: data.server_time,
                    receivedAt: Date.now()
                };
            });
        });

        s.on('player_update', (data: { player: PlayerState, server_time: number }) => {
            console.log('Player Updated');
            setRoomState(prev => prev ? { 
                ...prev, 
                player: data.player, 
                server_time: data.server_time,
                receivedAt: Date.now()
            } : null);
        });

        s.on('error', (err: any) => {
            console.error('Socket Error:', err);
            if (err.message === 'Invalid password') {
                setPasswordOpen(true);
            } else if (err.message === 'Room not found') {
                alert(err.message);
                navigate('/');
            } else {
                alert(err.message);
            }
        });
        
        s.on('kicked', () => {
            alert('You have been kicked!');
            navigate('/');
        });
        
        s.on('notification', (data: any) => {
            console.log(data.message);
        });

        s.on('user_joined', (data: any) => {
            console.log('User joined:', data);
            const state = roomStateRef.current;
            if (state && state.admin_sid === s.id && audioRef.current) {
                 console.log('Sending host sync for new user');
                 s.emit('host_sync', {
                     room_id: roomId,
                     timestamp: audioRef.current.currentTime,
                     is_playing: !audioRef.current.paused
                 });
            }
        });

        s.on('connect', () => {
            console.log('Connected');
            s.emit('join_room', {
                room_id: roomId,
                nickname,
                password,
                user_id: getUserId()
            });
        });

        return () => {
            s.disconnect();
        };
    }, [roomId, nickname, password, navigate]);

    // Host Sync Interval (Zombie Cleanup only)
    useEffect(() => {
        if (!socket || !roomId || !isAdmin) return;

        const interval = setInterval(() => {
             // Just send room_id for zombie cleanup. 
             // No timestamp means no player update and no sync_pulse broadcast.
             socket.emit('host_sync', { room_id: roomId });
        }, 5000); 

        return () => clearInterval(interval);
    }, [socket, roomId, isAdmin]);

    const handleManualSync = () => {
        if (!socket) return;
        console.log("Requesting manual sync...");
        socket.emit('request_sync', { room_id: roomId });
    };

    // Track Change Effect
    useEffect(() => {
        if (!roomState || !roomState.player || !audioRef.current) return;
        const player = roomState.player;
        const track = roomState.queue[player.current_track_index];
        
        if (track && track.stream_url) {
            let finalUrl = track.stream_url;
            const isLocal = finalUrl.startsWith('/');
            
            if (isLocal) {
                finalUrl = `${API_URL}${finalUrl}`;
            }

            const isHls = finalUrl.includes('.m3u8');
            const currentSrc = audioRef.current.src;
            
            // Check if source actually changed
            // For HLS we might not have currentSrc matching exactly, so we rely on track ID change potentially
            // But here we rely on URL. 
            // Note: currentSrc will have the full URL with cache buster if we added it.
            // So we should check if currentSrc INCLUDES the finalUrl.
            const urlChanged = !currentSrc.includes(finalUrl);

            if (urlChanged) {
                console.log("Loading new track:", finalUrl);
                // Force crossOrigin to anonymous before setting src
                audioRef.current.crossOrigin = "anonymous";
                
                if (isHls && Hls.isSupported()) {
                    if (hlsRef.current) {
                        hlsRef.current.destroy();
                    }
                    const hls = new Hls();
                    // Use proxy only if NOT local
                    const sourceUrl = isLocal ? finalUrl : `${API_URL}/proxy_media?url=${encodeURIComponent(track.stream_url)}`;
                    
                    hls.loadSource(sourceUrl);
                    hls.attachMedia(audioRef.current);
                    hlsRef.current = hls;

                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        if (player.is_playing) {
                            audioRef.current?.play().catch(e => console.error("Playback failed:", e));
                        }
                    });
                } else {
                    if (hlsRef.current) {
                        hlsRef.current.destroy();
                        hlsRef.current = null;
                    }
                    // Append timestamp to prevent caching of tainted response
                    const cacheBuster = finalUrl.includes('?') ? `&t=${Date.now()}` : `?t=${Date.now()}`;
                    audioRef.current.src = finalUrl + cacheBuster;
                }
            }
        } else if (!track) {
             if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            audioRef.current.src = "";
        }

        if (player.is_playing) {
            audioRef.current.play().catch(e => console.log("Autoplay blocked", e));
        } else {
            audioRef.current.pause();
        }
    }, [roomState?.player?.current_track_index, roomState?.queue, roomState?.player?.is_playing]);

    // Sync Effect
    useEffect(() => {
        if (!roomState || !roomState.player || !audioRef.current || isDragging) return;
        const player = roomState.player;

        // Calculate target time based on server state
        let targetTime = player.timestamp;
        
        // If playing, we need to account for elapsed time since start
        if (player.is_playing && roomState.server_time && player.start_time) {
            const baseTarget = Math.max(0, roomState.server_time - player.start_time);
            let elapsedSinceUpdate = 0;
            if (roomState.receivedAt) {
                elapsedSinceUpdate = (Date.now() - roomState.receivedAt) / 1000;
            }
            targetTime = baseTarget + elapsedSinceUpdate;
        }

        const diff = Math.abs(audioRef.current.currentTime - targetTime);
        
        // Since we removed periodic sync, we can trust player_update events.
        // We sync if there is any significant difference (> 0.5s)
        // This ensures that when ANY user seeks, everyone (including Host) syncs to that point.
        if (diff > 0.5 && !isDragging) {
             console.log(`Syncing time: client=${audioRef.current.currentTime}, target=${targetTime}, diff=${diff}`);
             audioRef.current.currentTime = targetTime;
        }
    }, [roomState?.player?.timestamp, roomState?.player?.start_time, roomState?.server_time, isDragging]);

    // Mouse move handler for 3D tilt effect
    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!coverRef.current) return;
        
        const card = coverRef.current;
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        
        const rotateX = ((y - centerY) / centerY) * 10; // Max 10 deg rotation
        const rotateY = ((centerX - x) / centerX) * 10;
        
        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(0.98, 0.98, 0.98)`;
    };

    const handleMouseLeave = () => {
        if (!coverRef.current) return;
        coverRef.current.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)';
    };

    // Audio Event Handlers
    const handleAddTrack = () => {
        if (!inputUrl || !socket) return;
        socket.emit('add_track', { room_id: roomId, url: inputUrl });
        setInputUrl('');
    };

    const handleShuffle = () => {
        console.log("Shuffle clicked", { socket: !!socket, roomId });
        if (!socket) return;
        socket.emit('shuffle_queue', { room_id: roomId });
    };

    const handlePrev = () => {
        console.log("Prev clicked", { socket: !!socket, roomId });
        if (!socket || !roomId) return;
        if (audioRef.current && audioRef.current.currentTime > 1) {
             socket.emit('player_control', { room_id: roomId, action: 'seek', timestamp: 0 });
        } else {
             socket.emit('player_control', { room_id: roomId, action: 'prev' });
        }
    };

    const handleLoop = () => {
        if (!socket) return;
        const modes = ['off', 'queue', 'track'];
        const currentMode = roomState?.player?.loop_mode || 'off';
        const nextMode = modes[(modes.indexOf(currentMode) + 1) % modes.length];
        socket.emit('player_control', { room_id: roomId, action: 'loop', loop_mode: nextMode });
    };

    const handleNext = () => {
        console.log("Next clicked", { socket: !!socket, roomId });
        socket?.emit('player_control', { room_id: roomId, action: 'next' });
    };

    const handleDragEnd = (event: any) => {
        const { active, over } = event;
        if (active.id !== over.id && roomState) {
            const oldIndex = roomState.queue.findIndex(t => t.id === active.id);
            const newIndex = roomState.queue.findIndex(t => t.id === over.id);
            const newQueue = arrayMove(roomState.queue, oldIndex, newIndex);
            setRoomState({ ...roomState, queue: newQueue });
            socket?.emit('reorder_queue', { room_id: roomId, queue_ids: newQueue.map(t => t.id) });
        }
    };


    const togglePlay = () => {
        console.log("Toggle Play clicked", { socket: !!socket, roomId, hasPlayer: !!roomState?.player, isPlaying: roomState?.player?.is_playing });
        if (!roomState || !roomState.player) return;
        const action = roomState.player.is_playing ? 'pause' : 'play';
        socket?.emit('player_control', { 
            room_id: roomId, 
            action, 
            timestamp: audioRef.current?.currentTime || 0 
        });
    };

    const handleExit = () => {
        navigate('/');
    };

    const changeLanguage = (lng: string) => {
        i18n.changeLanguage(lng);
        localStorage.setItem('jamable_language', lng);
    };

    const handlePasswordSubmit = () => {
        setPassword(passwordInput);
        setPasswordOpen(false);
    };

    const shareLink = `${window.location.origin}/room/${roomId}${includePwdInShare && password ? `?pwd=${password}` : ''}`;
    
    const copyToClipboard = () => {
        navigator.clipboard.writeText(shareLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    if (!roomState && !isJoinOpen && !isPasswordOpen) {
        return (
            <div className="min-h-screen bg-slate-950 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-screen bg-slate-950 text-white font-sans selection:bg-blue-500 selection:text-white">
            {/* Navbar */}
            <nav className="flex items-center justify-between px-6 py-4 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-40">
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => setExitOpen(true)}>
                     <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <Music className="text-white w-5 h-5" />
                    </div>
                    <span className="text-xl font-bold hidden sm:inline">Jamable</span>
                </div>
                
                <div className="flex items-center gap-3">
                    <button 
                        onClick={() => setShareOpen(true)}
                        className="bg-slate-800 border border-slate-700 px-3 py-1 rounded-full text-xs text-slate-400 font-mono hover:bg-slate-700 hover:text-white transition flex items-center gap-2"
                    >
                        {roomId}
                        <Share2 size={12} />
                    </button>

                    <div className="flex items-center gap-2 bg-slate-800 rounded-full px-3 py-1.5 border border-slate-700">
                        <Globe className="w-4 h-4 text-slate-400" />
                        <select 
                            className="bg-transparent text-sm text-slate-200 outline-none cursor-pointer"
                            onChange={(e) => changeLanguage(e.target.value)}
                            value={i18n.language}
                        >
                            <option value="en" className="bg-slate-800">EN</option>
                            <option value="ru" className="bg-slate-800">RU</option>
                            <option value="de" className="bg-slate-800">DE</option>
                        </select>
                    </div>

                    <button 
                        onClick={() => setExitOpen(true)}
                        className="p-2 text-slate-400 hover:text-red-400 transition"
                        title="Exit Room"
                    >
                        <LogOut size={20} />
                    </button>
                </div>
            </nav>

            <main className="flex-1 w-full max-w-7xl mx-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in-up">
                
                {/* Player Section */}
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl flex flex-col items-center justify-center text-center relative overflow-hidden">
                    {/* Sync Button */}
                    {!isAdmin && (
                        <button 
                            onClick={handleManualSync}
                            className="absolute top-4 right-4 p-2 bg-slate-800/50 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition z-20 backdrop-blur-sm"
                            title="Sync with Host"
                        >
                            <RefreshCw size={18} />
                        </button>
                    )}

                     {/* Background blur effect */}
                     {currentTrack?.thumbnail && (
                        <div 
                            className="absolute inset-0 bg-cover bg-center opacity-10 blur-xl scale-110 pointer-events-none"
                            style={{ backgroundImage: `url(${currentTrack.thumbnail})` }}
                        ></div>
                     )}

                    <div 
                        className="relative z-10 w-full mb-6 flex flex-col items-center justify-center transition-transform duration-100 ease-out"
                        ref={coverRef}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                    >
                        <img 
                            src={currentTrack?.thumbnail || 'https://placehold.co/600x400?text=Jammable'} 
                            alt="art" 
                            className={`w-48 h-48 sm:w-64 sm:h-64 object-cover rounded-xl shadow-2xl z-10 ring-1 ring-slate-700/50 ${roomState?.player?.is_playing ? 'animate-pulse-slow' : ''}`}
                            style={{ transition: 'transform 0.1s ease-out' }}
                        />
                    </div>
                    
                    <div className="z-10 w-full mb-6">
                        <h2 className="text-2xl font-bold mb-1 truncate px-4 text-white w-full">{currentTrack?.title || t('waiting_for_tracks', 'Waiting for tracks...')}</h2>
                        {currentTrack?.author && <p className="text-lg text-slate-300 truncate px-4 w-full mb-1">{currentTrack.author}</p>}
                        <p className="text-slate-400 text-sm truncate px-4 w-full">{currentTrack?.added_by ? `Added by ${currentTrack.added_by}` : 'Add a link to start'}</p>
                    </div>
                    
                    <div className="w-full max-w-lg space-y-6 z-10">
                        <div className="flex items-center gap-3 w-full">
                            <span className="text-xs text-slate-400 font-mono w-10 text-right">{formatTime(currentTime)}</span>
                            <input 
                                type="range" 
                                min="0" 
                                max={duration || 100} 
                                value={currentTime}
                                onMouseDown={() => setIsDragging(true)}
                                onTouchStart={() => setIsDragging(true)}
                                onChange={(e) => {
                                    setCurrentTime(Number(e.target.value)); // Visual only
                                }}
                                onMouseUp={(e) => {
                                    setIsDragging(false);
                                    const time = Number(e.currentTarget.value);
                                    if (audioRef.current) audioRef.current.currentTime = time;
                                    socket?.emit('player_control', { room_id: roomId, action: 'seek', timestamp: time });
                                }}
                                onTouchEnd={() => {
                                    setIsDragging(false);
                                    // For touch, e.target.value might not be available directly on touchEnd in some browsers
                                    // Use state currentTime which was updated by onChange
                                    if (audioRef.current) audioRef.current.currentTime = currentTime;
                                    socket?.emit('player_control', { room_id: roomId, action: 'seek', timestamp: currentTime });
                                }}
                                className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
                            />
                            <span className="text-xs text-slate-400 font-mono w-10">{formatTime(duration)}</span>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row justify-center items-center gap-4 w-full">
                            <div className="flex items-center gap-6 relative z-50 justify-center">
                                <button onClick={handleShuffle} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition" title="Shuffle">
                                    <Shuffle size={20} />
                                </button>
                                <button onClick={handlePrev} className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition"><SkipBack size={28}/></button>
                                <button onClick={togglePlay} className="w-16 h-16 flex items-center justify-center bg-blue-600 rounded-full hover:bg-blue-500 shadow-lg shadow-blue-600/30 transform hover:scale-105 transition">
                                    {roomState?.player?.is_playing ? <Pause fill="white" size={32} /> : <Play fill="white" size={32} className="ml-1"/>}
                                </button>
                                <button onClick={handleNext} className="p-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-full transition"><SkipForward size={28}/></button>
                                <button onClick={handleLoop} className={`p-2 rounded-full transition ${roomState?.player?.loop_mode === 'track' ? 'text-blue-500 bg-blue-500/10' : roomState?.player?.loop_mode === 'queue' ? 'text-green-500 bg-green-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`} title="Loop">
                                    {roomState?.player?.loop_mode === 'track' ? <Repeat1 size={20} /> : <Repeat size={20} />}
                                </button>
                            </div>
                        </div>

                         {/* Volume Control - New Position */}
                        <div className="flex items-center gap-4 w-full justify-center mt-6 z-10">
                            <button onClick={() => {
                                if (volume > 0) {
                                    setLastVolume(volume);
                                    setVolume(0);
                                } else {
                                    setVolume(lastVolume > 0 ? lastVolume : 1);
                                }
                            }} className="text-slate-400 hover:text-white transition">
                                {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={volume}
                                onChange={(e) => setVolume(parseFloat(e.target.value))}
                                className="w-full max-w-xs h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-400 hover:accent-white transition-all"
                            />
                        </div>
                    </div>
                    <audio 
                        ref={audioRef} 
                        crossOrigin="anonymous"
                        className="hidden" 
                        onTimeUpdate={(e) => {
                            if (!isDragging) setCurrentTime(e.currentTarget.currentTime);
                        }}
                        onLoadedMetadata={(e) => {
                            setDuration(e.currentTarget.duration);
                            e.currentTarget.volume = volume;
                            // Initial sync when metadata loads
                            if (roomState?.player?.is_playing && roomState.server_time && roomState.player.start_time) {
                                const baseTarget = Math.max(0, roomState.server_time - roomState.player.start_time);
                                let elapsedSinceUpdate = 0;
                                if (roomState.receivedAt) {
                                    elapsedSinceUpdate = (Date.now() - roomState.receivedAt) / 1000;
                                }
                                const targetTime = baseTarget + elapsedSinceUpdate;
                                console.log("Initial sync on metadata load:", targetTime);
                                e.currentTarget.currentTime = targetTime;
                            }
                        }}
                        onEnded={() => {
                            if (isAdmin && socket) {
                                // Simplified onEnded logic - let backend handle loop modes
                                socket.emit('player_control', { room_id: roomId, action: 'next', auto: true });
                            }
                        }}
                        onError={(e) => {
                            console.error("Audio playback error:", e);
                            const error = (e.target as HTMLAudioElement).error;
                            console.error("Error details:", error?.code, error?.message);
                            
                            // Auto-skip if playback fails
                            if (isAdmin && roomState?.player?.is_playing) {
                                console.log("Skipping broken track...");
                                setTimeout(() => {
                                    // Use handleNext directly if available, or emit socket event
                                    socket?.emit('player_control', { room_id: roomId, action: 'next' });
                                }, 1000);
                            }
                        }}
                    />
                </div>

                {/* Queue Section */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden h-[600px] lg:h-auto lg:relative">
                    <div className="flex flex-col h-full p-6 lg:absolute lg:inset-0">
                        <h3 className="font-bold text-slate-400 mb-4 uppercase text-xs tracking-wider flex items-center gap-2 flex-shrink-0">
                            {t('queue')} <span className="bg-slate-800 px-2 py-0.5 rounded-full text-slate-500">{roomState?.queue.length || 0}</span>
                        </h3>
                        
                        <div className="flex gap-2 mb-6 flex-shrink-0">
                            <input 
                                type="text" 
                                value={inputUrl}
                                onChange={e => setInputUrl(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddTrack()}
                                placeholder={t('enter_link')}
                                className="flex-1 p-3 rounded-xl bg-slate-800 border border-slate-700 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition text-sm text-white placeholder-slate-500"
                            />
                            <button onClick={handleAddTrack} className="bg-blue-600 px-5 rounded-xl font-bold hover:bg-blue-500 transition shadow-lg shadow-blue-600/20">
                                +
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-0 pr-2">
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                <SortableContext items={roomState?.queue.map(t => t.id) || []} strategy={verticalListSortingStrategy}>
                                    <div className="space-y-2">
                                        {roomState?.queue.map((track, i) => (
                                            <SortableItem 
                                                key={track.id} 
                                                track={track} 
                                                isAdmin={isAdmin} 
                                                onDelete={(id: string) => socket?.emit('remove_track', { room_id: roomId, track_id: id })}
                                                currentId={currentTrack?.id}
                                                myNickname={nickname}
                                                queueIndex={i}
                                                onPlay={(id: string) => socket?.emit('play_track', { room_id: roomId, track_id: id })}
                                            />
                                        ))}
                                        {roomState?.queue.length === 0 && (
                                            <div className="text-center py-8 text-slate-500 border-2 border-dashed border-slate-800 rounded-xl">
                                                <p>{t('empty_queue')}</p>
                                            </div>
                                        )}
                                    </div>
                                </SortableContext>
                            </DndContext>
                        </div>
                    </div>
                </div>

                {/* Users Section */}
                <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl shadow-xl lg:col-span-2">
                     <h3 className="font-bold text-slate-400 mb-4 uppercase text-xs tracking-wider flex items-center gap-2">
                        {t('users')} <span className="bg-slate-800 px-2 py-0.5 rounded-full text-slate-500">{roomState?.users.length || 0}</span>
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {roomState?.users.map((u, i) => (
                            <div key={u.sid + i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
                                <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                                <span className="text-sm font-medium text-slate-200">{u.nickname}</span>
                                {u.sid === roomState.admin_sid && <Crown size={14} className="text-yellow-500" />}
                                {isAdmin && u.sid !== socket?.id && (
                                    <button 
                                        onClick={() => socket?.emit('kick_user', { room_id: roomId, target_sid: u.sid })}
                                        className="ml-2 text-slate-600 hover:text-red-500 transition"
                                        title={t('kick')}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

            </main>

            {/* Exit Modal */}
            <Modal isOpen={isExitOpen} onClose={() => setExitOpen(false)} title="Exit Room?">
                <div className="space-y-4">
                    <p className="text-slate-300">Are you sure you want to leave this room?</p>
                    <div className="flex gap-3">
                        <button 
                            onClick={() => setExitOpen(false)}
                            className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold transition"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleExit}
                            className="flex-1 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-bold shadow-lg shadow-red-600/20 transition"
                        >
                            Exit
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Password Modal */}
            <Modal isOpen={isPasswordOpen} onClose={() => {}} title="Password Required">
                <div className="space-y-4">
                     <div className="flex justify-center text-blue-500 mb-4">
                        <Lock size={48} />
                    </div>
                    <p className="text-slate-300 text-center">This room is protected by a password.</p>
                    <input 
                        type="password" 
                        value={passwordInput}
                        onChange={e => setPasswordInput(e.target.value)}
                        className="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition text-white"
                        placeholder="Enter password"
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && handlePasswordSubmit()}
                    />
                    <button 
                        onClick={handlePasswordSubmit}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold shadow-lg shadow-blue-600/20 transition"
                    >
                        Join Room
                    </button>
                </div>
            </Modal>

            {/* Share Modal */}
            <Modal isOpen={isShareOpen} onClose={() => setShareOpen(false)} title="Share Room">
                <div className="space-y-4">
                    <p className="text-slate-300">Invite friends to listen together!</p>
                    
                    <div className="flex items-center gap-2 bg-slate-800 p-2 rounded-lg border border-slate-700">
                        <input 
                            type="text" 
                            readOnly 
                            value={shareLink}
                            className="flex-1 bg-transparent outline-none text-slate-300 text-sm font-mono"
                        />
                        <button onClick={copyToClipboard} className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition">
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                    </div>

                    {password && (
                        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setIncludePwdInShare(!includePwdInShare)}>
                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition ${includePwdInShare ? 'bg-blue-600 border-blue-600' : 'border-slate-500'}`}>
                                {includePwdInShare && <Check size={14} />}
                            </div>
                            <span className="text-slate-300 select-none">Include password in link</span>
                        </div>
                    )}
                </div>
            </Modal>

            {/* Join Modal */}
            <Modal isOpen={isJoinOpen} onClose={() => {}} title="Join Room">
                <div className="space-y-4">
                    <p className="text-slate-300">Enter a nickname to join this room.</p>
                    <input 
                        type="text" 
                        placeholder="Your Nickname"
                        className="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition text-white"
                        autoFocus
                        id="join-nickname-input"
                    />
                    
                    {hasPasswordProtection && !password && (
                        <input 
                            type="password" 
                            placeholder="Room Password"
                            className="w-full p-3 rounded-lg bg-slate-900 border border-slate-700 focus:border-blue-500 outline-none transition text-white"
                            id="join-password-input"
                        />
                    )}

                    <div className="flex flex-col gap-2">
                         <button 
                            onClick={() => {
                                const nicknameInput = (document.getElementById('join-nickname-input') as HTMLInputElement).value;
                                const passwordInput = (document.getElementById('join-password-input') as HTMLInputElement)?.value;
                                
                                if (nicknameInput) {
                                    handleJoinSubmit(nicknameInput, passwordInput);
                                } else {
                                    alert('Please enter a nickname');
                                }
                            }}
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold shadow-lg shadow-blue-600/20 transition"
                        >
                            Join
                        </button>
                        <button 
                            onClick={() => {
                                const passwordInput = (document.getElementById('join-password-input') as HTMLInputElement)?.value;
                                handleJoinSubmit(`Guest_${Math.floor(Math.random()*1000)}`, passwordInput);
                            }}
                            className="w-full py-3 bg-slate-700 hover:bg-slate-600 rounded-lg font-bold transition text-slate-300"
                        >
                            Continue as Guest
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default Room;