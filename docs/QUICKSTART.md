# Quick Start Guide (10 minutes)

Get the travel agent demo running quickly without a local LLM.

## Prerequisites

- Node.js v16+
- Anam API key (lab.anam.ai)
- Mapbox API token
- Optional: Pexels API key for live photos/videos
- Optional: Mapillary token for street imagery

## Step 1: Backend (session token server)

```bash
cd backend
npm install
```

Create `backend/.env`:

```bash
ANAM_API_KEY=your_anam_api_key_here
PORT=3001
CORS_ORIGINS=http://localhost:3000
PHOTO_PROVIDER=auto
VIDEO_PROVIDER=pexels
PEXELS_API_KEY=

# Optional provider overrides
OPENVERSE_API_URL=https://api.openverse.org/v1/images
OPENVERSE_LICENSE_TYPE=all
PEXELS_API_URL=https://api.pexels.com/v1/search
PEXELS_VIDEO_API_URL=https://api.pexels.com/videos/search
```

Start the server:

```bash
npm start
```

## Step 2: Frontend

```bash
cd ../frontend
npm install
```

Create `frontend/.env`:

```bash
VITE_MAPBOX_TOKEN=your_mapbox_token_here
VITE_BACKEND_URL=http://localhost:3001
VITE_CITY=tunis
VITE_DEMO_MODE=true
VITE_TOOL_FALLBACK=false
VITE_MAPILLARY_TOKEN=
VITE_LIVE_PHOTOS=false
VITE_PHOTO_PROVIDER=auto
VITE_VIDEO_PROVIDER=pexels
```

Notes:
- Set `VITE_CITY` to `tunis` or `istanbul`.
- Set `VITE_MAPILLARY_TOKEN` to enable street imagery.
- Set `VITE_LIVE_PHOTOS=true` to enable live media (photos + videos) from the backend.
- Keep `PHOTO_PROVIDER` and `VITE_PHOTO_PROVIDER` aligned when using live photos.
- Video search requires a valid `PEXELS_API_KEY`.

Start the dev server:

```bash
npm run dev
```

Tip: from the repo root, run `.\run-anam-travel.cmd` to start backend + frontend together (use `-Install` once).

## Step 3: Test the demo

1. Open `http://localhost:3000`
2. Click "Start Your Journey"
3. Ask: "Tell me about Tunis"

## Troubleshooting

### Mapbox not rendering

- Verify `VITE_MAPBOX_TOKEN` is set and valid.
- Check the browser console for errors.
- If the map is black, ensure hardware acceleration is enabled.

### Anam connection issues

- Confirm the backend is running at `VITE_BACKEND_URL`.
- Verify `ANAM_API_KEY` and CORS settings.
- Check the browser console for WebRTC errors.

### Media relevance issues

- Update `photoQuery`, `videoQuery`, `videoInclude`, `videoExclude`, and `photoExclude` in `frontend/src/data/landmarks_db.json`.

## Next steps

- Update curated media and filters per landmark.
- Add new cities in `frontend/src/data/landmarks_db.json`.
- Tune the persona system prompt in `frontend/src/components/TravelAgentDemo.tsx`.
