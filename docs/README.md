# AI Travel Agent with Synchronized Map Visualization

## Overview

This demo showcases sophisticated UI synchronization with Anam's AI personas. As the travel agent persona (Sofia) describes landmarks in Tunis, the map automatically zooms, highlights, and displays information about each location in real time, synchronized with her speech.

## Key Features

### 1. Speech-Synchronized Map Highlighting
- As Sofia mentions "Medina of Tunis", the map zooms to the Medina and displays details
- Landmarks appear progressively as they are mentioned in the conversation
- Smooth animations and transitions create a cinematic experience

### 2. Tool-Driven Orchestration (No Local LLM)
- Uses Anam-hosted LLM with Client Tools to trigger deterministic UI actions
- Keeps orchestration logic in the frontend, where timing is easiest to manage

### 3. Real-Time UI Orchestration
- Listens to Anam events for tool calls and speech state
- Coordinates map animations with the persona in real time
- Handles interruptions and resumes cleanly

## Architecture

```
User Browser
  - React UI + Mapbox GL
  - Anam SDK (persona, tools, events)
  - UI Orchestrator (tool handlers)

Backend (recommended)
  - Session token endpoint (keeps API key off the client)

Anam Servers
  - LLM + TTS + video generation
```

## Prerequisites

1. Node.js (v16+)
2. Anam API key (from lab.anam.ai)
3. Mapbox API token (from mapbox.com)

## Installation

For step-by-step setup, see `docs/QUICKSTART.md`.

### Step 1: Create a Session Token Backend

You need a backend endpoint to exchange your Anam API key for session tokens. The persona config can be included here or set in the client before streaming.

```javascript
// Example Express.js endpoint
app.post('/api/anam/session-token', async (req, res) => {
  const { personaConfig, clientLabel } = req.body;

  try {
    const payload = {
      clientLabel: clientLabel || 'anam-travel-agent'
    };
    if (personaConfig) {
      payload.personaConfig = personaConfig;
    }

    const response = await fetch('https://api.anam.ai/v1/auth/session-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ANAM_API_KEY}`,
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get session token' });
  }
});
```

### Step 2: Set Up Frontend

Install dependencies:

```bash
npm install @anam-ai/js-sdk mapbox-gl framer-motion
```

### Step 3: Configure Environment Variables

Create a `.env` file:

```bash
# Backend
ANAM_API_KEY=your_anam_api_key_here
PORT=3001
CORS_ORIGINS=http://localhost:3000
OPENVERSE_API_URL=https://api.openverse.org/v1/images
OPENVERSE_LICENSE_TYPE=all
PEXELS_API_KEY=
PEXELS_API_URL=https://api.pexels.com/v1/search
PHOTO_PROVIDER=auto

# Frontend
VITE_MAPBOX_TOKEN=your_mapbox_token_here
VITE_BACKEND_URL=http://localhost:3001
VITE_CITY=tunis
VITE_DEMO_MODE=true
VITE_TOOL_FALLBACK=false
VITE_MAPILLARY_TOKEN=
VITE_LIVE_PHOTOS=false
VITE_PHOTO_PROVIDER=auto
```

Set `VITE_CITY` to `tunis` or `istanbul` to choose the default city.
Set `VITE_MAPILLARY_TOKEN` to enable street-level imagery (Mapillary).
Set `VITE_LIVE_PHOTOS=true` to fetch live photos from Openverse/Pexels.
Set `PHOTO_PROVIDER=auto|openverse|pexels` (backend) and `VITE_PHOTO_PROVIDER` to the same value.

## Usage

1. Start the session token backend
2. Start your React app
3. (Optional) Set `VITE_CITY=istanbul` to switch the default city
4. Click "Start Your Journey"
5. Ask Sofia about the city: "Tell me about Tunis"
6. Watch as landmarks are highlighted in sync with her speech

### Example Queries

- "Tell me about Tunis"
- "What can I see in the Medina?"
- "Tell me about the ancient ruins of Carthage"
- "What's the most beautiful spot in Tunis?"
- "I'm interested in historical sites"

## How the Synchronization Works

### 1. Tool Calls Drive the UI

The persona is configured with Client Tools. When Sofia decides to highlight a landmark, she calls a tool like `fly_to_landmark` or `show_landmark_panel`.

```javascript
client.addListener(AnamEvent.CLIENT_TOOL_EVENT_RECEIVED, (event) => {
  // eventData can be a JSON string, so normalize before passing along.
  orchestrator.handleToolCall(event.eventName, event.eventData);
});
```

If your SDK still emits `TOOL_CALL`, register that event too and pass the same handler.

### 2. Real-Time Speech Tracking

The UI can react to speech state for indicators and interruptions.

```javascript
client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (event) => {
  if (event.type === 'persona') {
    setPersonaState('speaking');
  }
});
```

### 3. Synchronized UI Updates

The orchestrator performs the actual UI choreography.

```javascript
await orchestrator.handleToolCall('fly_to_landmark', { id: 'medina', zoom: 15 });
```

## Customization

### Adding New Locations

Edit `frontend/src/data/landmarks_db.json`:

```json
{
  "paris": {
    "city": {
      "name": "Paris",
      "coordinates": [2.3522, 48.8566],
      "zoom": 12
    },
    "landmarks": [
      {
        "id": "eiffel-tower",
        "name": "Eiffel Tower",
        "coordinates": [2.2945, 48.8584],
        "description": "Iconic iron lattice tower...",
        "zoom": 16
      }
    ]
  }
}
```

### Customizing the Persona

Modify the system prompt in `frontend/src/components/TravelAgentDemo.tsx` and adjust tool descriptions and usage guidance.

## Performance Optimization

### Reduce Latency

1. Keep responses concise (2 to 4 sentences per landmark)
2. Preload landmark data in the frontend
3. Reduce map detail if needed for smoother animation
4. Keep tool calls deterministic with clear prompt guidance

### Improve Quality

1. Add more context to the system prompt
2. Improve landmark descriptions and highlights
3. Tune tool descriptions to reduce missed calls

## Troubleshooting

### Landmarks Not Highlighting

1. Check browser console for errors
2. Verify landmark IDs match tool parameters
3. Confirm tools are defined in the persona config
4. Check Mapbox token is valid
5. For map-only debugging, set `VITE_TOOL_FALLBACK=true` and `VITE_DEMO_MODE=false` to run a scripted tool sequence

### Anam Connection Issues

1. Verify API key is correct
2. Check session token endpoint is working
3. Ensure CORS is configured properly
4. Check browser console for WebRTC errors

## What Makes This Impressive

### 1. Novel Use of Anam Features
- Goes beyond documented examples
- Uses Client Tools for deterministic choreography
- Shows creative thinking about UI and voice

### 2. Technical Sophistication
- Real-time event driven synchronization
- Tool-first architecture with clean boundaries
- Smooth animation choreography

### 3. Production-Ready Quality
- Error handling
- Performance optimization
- Responsive design
- Polished UI and UX

### 4. Demonstrates Deep Understanding
- Understands Anam's architecture
- Knows when to use client-side orchestration
- Thinks about latency and user experience

## Next Steps

### Enhancements to Consider

1. Multi-city support
2. User preferences
3. 3D landmark models
4. Route planning between landmarks
5. Weather integration
6. Photo gallery expansions
7. User reviews and ratings
8. Booking integrations

### Advanced Features

1. Voice commands
2. Gesture control
3. AR mode
4. Multi-language support
5. Offline mode for maps
6. Social sharing

## License

MIT License - Feel free to use and modify

## Credits

- Anam AI for persona technology
- Mapbox for mapping platform
- OpenStreetMap for geographic data
- Landmark photos and attribution details in `docs/ASSETS.md`
