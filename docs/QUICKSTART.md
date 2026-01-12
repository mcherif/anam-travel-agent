# Quick Start Guide - 10 Minutes to Demo

Get the travel agent demo running quickly without a local LLM.

## Prerequisites Check (2 minutes)

```bash
# Check Node.js (recommend v18+ for built-in fetch)
node --version
```

If missing:
- Node.js: https://nodejs.org/

You will also need:
- Anam API key (from lab.anam.ai)
- Mapbox API token (from mapbox.com)

---

## Step 1: Backend Setup (Session Token Server) (3 minutes)

Install backend dependencies and set your API key.

```bash
cd backend
npm install
```

Create `backend/.env` (or copy from `.env.example`):

```bash
ANAM_API_KEY=your_anam_api_key_here
PORT=3001
CORS_ORIGINS=http://localhost:3000
```

Start the server:

```bash
node server.js
```

---

## Step 2: Frontend Setup (4 minutes)

From the `frontend` directory:

```bash
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
```

Set `VITE_CITY` to `tunis` or `istanbul` to choose the default city.
Set `VITE_MAPILLARY_TOKEN` to enable street-level imagery (Mapillary).

Start the dev server:

```bash
npm run dev
```


---

## Step 3: Test the Demo (1 minute)

1. Open the frontend URL (usually `http://localhost:3000`)
2. Click "Start Your Journey"
3. Allow microphone access
4. (Optional) Set `VITE_CITY=istanbul` if you want to switch cities
5. Say: "Tell me about Tunis"

---

## Troubleshooting

### Session Token Issues

- Confirm `ANAM_API_KEY` is set in `backend/.env`
- Check the backend logs for errors
- Verify the endpoint URL matches your frontend config

### Mapbox Issues

- Verify `VITE_MAPBOX_TOKEN` is set
- Check browser console for 401 errors

### Anam Connection Issues

- Verify API key validity
- Confirm the token endpoint is reachable
- Check browser console for WebRTC errors

---

## Next Steps

- Tune the system prompt to improve tool call reliability
- Add more landmarks in `frontend/src/data/landmarks_db.json`
- Swap map styles or optimize animations for performance
