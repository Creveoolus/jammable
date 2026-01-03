import os
import logging
import asyncio
from typing import Optional, Dict, Any
from yt_dlp import YoutubeDL
import requests
from bs4 import BeautifulSoup

try:
    from spotdl import Spotdl
    from spotdl.types.song import Song
except ImportError:
    Spotdl = None
    Song = None

logger = logging.getLogger(__name__)

def _scrape_metadata(url: str) -> Optional[Dict[str, Optional[str]]]:
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        # Special handling for Spotify to avoid login redirection if possible, though standard UA usually works for public metadata
        response = requests.get(url, headers=headers, timeout=5)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, 'html.parser')
        
        metadata = {
            'title': None,
            'author': None
        }

        # Try og:title
        og_title = soup.find('meta', property='og:title')
        if og_title and og_title.get('content'):
            metadata['title'] = og_title['content']
            
        # Try og:description or other artist fields
        og_artist = soup.find('meta', property='og:audio:artist') or soup.find('meta', property='music:musician')
        if og_artist and og_artist.get('content'):
             metadata['author'] = og_artist['content']

        # Fallback for title
        if not metadata['title'] and soup.title and soup.title.string:
            metadata['title'] = soup.title.string

        # Parse page title for Author if missing (Common in SoundCloud: "Stream Title by Author | ...")
        if not metadata['author'] and soup.title and soup.title.string:
            title_text = soup.title.string
            if ' by ' in title_text:
                parts = title_text.split(' by ')
                if len(parts) >= 2:
                    # Clean up suffix like " | Listen online..."
                    author_part = parts[1].split('|')[0].strip()
                    metadata['author'] = author_part
        
        # If we still have a title but no author, return what we have
        if metadata['title']:
            return metadata
            
        return None
    except Exception as e:
        logger.error(f"Metadata scraping error: {e}")
        return None

def _extract_info(url: str) -> Optional[Dict[str, Any]]:
    proxy_url = os.getenv('PROXY_URL')
    cookies_path = '/app/cookies.txt'
    
    # Check if input is a URL
    is_url = url.startswith(('http://', 'https://'))

    # Ensure media directory exists
    media_dir = os.path.join(os.getcwd(), 'static', 'media')
    os.makedirs(media_dir, exist_ok=True)

    ydl_opts = {
        'format': 'bestaudio[ext=mp3]/bestaudio[ext=m4a]/bestaudio/best',
        'noplaylist': True,
        'quiet': True,
        'skip_download': False,
        'outtmpl': os.path.join(media_dir, '%(id)s.%(ext)s'),
        'default_search': 'auto',
        'source_address': '0.0.0.0', # bind to ipv4
        'js_runtimes': {'node': {}}, # Explicitly enable node for signature solving
        'force_generic_extractor': False,
    }
    
    if proxy_url:
        ydl_opts['proxy'] = proxy_url
        
    source = 'unknown'
    
    if not is_url:
        # If not a URL, treat as search query on SoundCloud
        ydl_opts['default_search'] = 'scsearch'
        source = 'soundcloud'
    elif 'soundcloud.com' in url:
        source = 'soundcloud'
    else:
        # Try to scrape metadata and search on SoundCloud
        metadata = _scrape_metadata(url)
        if metadata and metadata.get('title'):
            meta_title = metadata['title']
            meta_author = metadata.get('author')

            # Clean common suffixes from title
            for suffix in [' - YouTube', ' | Spotify', ' on Spotify', ' | Music', ' - Apple Music']:
                 meta_title = meta_title.replace(suffix, '')
            
            search_query = meta_title
            if meta_author:
                search_query = f"{meta_author} - {meta_title}"
            
            logger.info(f"Scraped metadata '{search_query}' from {url}, searching on SoundCloud")
            ydl_opts['default_search'] = 'scsearch'
            url = search_query
            source = 'soundcloud'
        else:
            # Fallback to original logic if scraping fails
            should_use_cookies = 'spotify.com' in url or 'youtube.com' in url or 'youtu.be' in url
            if should_use_cookies and os.path.exists(cookies_path):
                ydl_opts['cookiefile'] = cookies_path
                
            if 'spotify.com' in url:
                source = 'spotify'
                if Spotdl:
                    try:
                        # Initialize SpotDL
                        spotdl = Spotdl(
                            client_id=os.getenv('SPOTIPY_CLIENT_ID'), 
                            client_secret=os.getenv('SPOTIPY_CLIENT_SECRET')
                        )
                        songs = spotdl.search([url])
                        if songs:
                            url = songs[0].url # Use the found YouTube URL
                    except Exception as e:
                        logger.error(f"SpotDL error: {e}")
                        
            if 'youtube.com' in url or 'youtu.be' in url:
                source = 'youtube'

    with YoutubeDL(ydl_opts) as ydl:
        try:
            # We must download to get the file
            info = ydl.extract_info(url, download=True)
            
            # If it's a playlist or search result, take the first entry
            if 'entries' in info:
                info = info['entries'][0]
                
            # Determine filename
            filename = ydl.prepare_filename(info)
            # We want the relative path for the frontend
            # prepare_filename returns absolute path because outtmpl is absolute
            # We need relative to backend root (which is where main.py runs? or static mount?)
            # The mount is at /static.
            # filename: c:\...\static\media\id.ext
            basename = os.path.basename(filename)
            stream_url = f"/static/media/{basename}"
                
            return {
                "stream_url": stream_url,
                "title": info.get('title', 'Unknown Track'),
                "author": info.get('uploader') or info.get('artist') or info.get('creator') or info.get('channel'),
                "thumbnail": info.get('thumbnail'),
                "duration": info.get('duration'),
                "source": source
            }
        except Exception as e:
            logger.error(f"yt-dlp extraction error: {e}")
            return None

async def resolve_media(url: str) -> Optional[Dict[str, Any]]:
    """
    Resolves a media URL using yt-dlp in a thread pool to avoid blocking.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _extract_info, url)
