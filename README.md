# Jamable 🎵

Jamable is a real-time music synchronization application that allows you to listen to music with friends simultaneously. It supports various sources including YouTube, SoundCloud, and Spotify.

## Prerequisites

- [Docker](https://www.docker.com/get-started)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Configuration

The application is configured using a single `.env` file in the root directory. This file controls both the frontend build variables and backend runtime configuration.

### Step 1: Create Configuration File

Copy the example configuration file:

```bash
cp .env.example .env
```

### Step 2: Configure Environment Variables

Open `.env` and adjust the settings according to your environment.

#### Domain Settings
These settings are critical for correct routing and CORS configuration.

- `DOMAIN_NAME`: The main domain where the frontend will be accessible (e.g., `localhost` or `jamable.space`).
- `API_DOMAIN`: The domain (and port) where the backend API is accessible (e.g., `localhost:8000` or `api.jamable.space`).
- `PROTOCOL`: `http` or `https`.

**Example for Local Development:**
```env
DOMAIN_NAME=localhost
API_DOMAIN=localhost:8000
PROTOCOL=http
```

**Example for Production (with custom domains):**
```env
DOMAIN_NAME=jamable.space
API_DOMAIN=api.jamable.space
PROTOCOL=https
```

#### Backend Services
- `ALLOWED_ORIGINS`: Comma-separated list of allowed origins for CORS (e.g., `https://jamable.space` or `*`).
- `SPOTIPY_CLIENT_ID` & `SPOTIPY_CLIENT_SECRET`: (Optional) Required for better Spotify support. Get credentials from [Spotify Dashboard](https://developer.spotify.com/dashboard).
- `PROXY_URL`: (Optional) Proxy for media fetching if needed.

## Installation & Running

### Start with Docker Compose

To build and start the application:

```bash
docker compose up -d --build
```

This command will:
1. Build the Frontend (React/Vite) with the `VITE_API_URL` injected from your `.env`.
2. Build the Backend (FastAPI).
3. Start Redis, Backend, and Frontend containers.

### Accessing the Application

- **Frontend**: http://localhost:3000 (or the port defined in docker-compose)
- **Backend API**: http://localhost:8000

## Development

If you change the `DOMAIN_NAME` or `API_DOMAIN` in `.env`, you **must rebuild** the frontend container for changes to take effect:

```bash
docker compose up -d --build frontend
```

## Project Structure

- `frontend/`: React application (Vite, TypeScript, TailwindCSS).
- `backend/`: Python application (FastAPI, Socket.IO, yt-dlp).
- `docker-compose.yml`: Orchestration for services.
