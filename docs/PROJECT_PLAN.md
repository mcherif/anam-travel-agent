# AI Travel Agent with Synchronized Map - Project Plan v2.0

## Executive Overview

This project demonstrates the full potential of Anam's Client Tools by building an AI travel agent that **intentionally orchestrates UI state changes** as she speaks. Sofia describes landmarks in Tunis while explicitly calling tools that zoom the map, highlight locations, and display information creating a cinematic, voice-driven spatial experience.

**Key Innovation:** Using Anam's Client Tools as the primary orchestration mechanism (not keyword inference), the AI persona controls the UI deterministically, showcasing the platform's true capabilities for "spatial AI" experiences.

**Target Audience:** Anam's team, as a demonstration of advanced Client Tools usage and potential contribution to their SDK ecosystem.

**MVP Focus:** Tunis-only, scripted for external demo reliability, with deterministic tool calls and minimal dependencies.

---

## What Makes This Anam-Native

### Using Client Tools as Intended

Instead of inferring UI actions from text, Sofia explicitly calls tools:
- `fly_to_landmark({ id, zoom })` - Animate map to landmark
- `show_landmark_panel({ id })` - Display information panel
- `dim_previous_landmarks()` - Fade older markers
- `highlight_route({ from, to })` - Show path between landmarks (v2)

This approach:
- **Reliable** - Deterministic tool calls, not fuzzy keyword matching
- **Anam-native** - Uses documented client tool events
- **Testable** - Clear contract between persona and UI
- **Reusable** - Pattern applies to any spatial UI scenario

### Demonstrating Real-Time Systems Engineering

**Interrupt Handling:**
- User speech interrupts persona   Cancel map animations
- Show "Interrupted" state   Resume gracefully
- Demonstrates understanding of real-time interaction design

**Debug HUD:**
- Live display of Anam events (tool calls, streaming text)
- Measured latencies (LLM   Audio   UI)
- Tool call queue visualization
- Shows observability thinking + production mindset

---

## Architecture Overview

```

                         User Browser

      React Frontend

        Anam SDK          UI                Debug HUD
          Video/Audio     Orchestrator        Events
          TOOL_EVENT        Map mgmt          Latencies
          Interrupts        Animations        Tool queue




                       Event-Driven Flow
                  TOOL_EVENT  Execute   Update UI



                            Session Token + WebRTC

                    Anam's Servers
                 (Persona + TTS + Video)

                            Tool definitions in personaConfig



             Your Backend (Optional)
             Session token generation
             Analytics / logging
             Future: Custom LLM proxy

```

### Key Architectural Decisions

**1. Tool-First Approach**
- Persona explicitly calls tools (not inferred from text)
- UI orchestrator subscribes to client tool events
- Clean separation: LLM decides *what*, orchestrator handles *how*

**2. Interrupt-Aware State Machine**
```
States: IDLE   LISTENING   SPEAKING   INTERRUPTED   RESUMING
Transitions handle: animation cancellation, state cleanup
```

**3. Measured Observability**
- Track latency at each stage
- Visualize tool call queue
- Log all events for debugging

---

## Core Innovation: Tool-Driven Orchestration

### The Old Way (Fragile)
```javascript
//   Keyword matching - breaks on rephrase
if (text.includes("Medina")) {
  highlightLandmark("medina");
}
```

### The Anam-Native Way (Robust)
```javascript
//   Explicit tool calls from persona
client.addListener(AnamEvent.CLIENT_TOOL_EVENT_RECEIVED, (event) => {
  const toolName = event.eventName;
  const toolArgs = event.eventData;

  switch(toolName) {
    case 'fly_to_landmark':
      orchestrator.flyTo(toolArgs.id, toolArgs.zoom);
      break;
    case 'show_landmark_panel':
      orchestrator.showPanel(toolArgs.id);
      break;
  }
});
```

### System Prompt Design

```markdown
You are Sofia, an enthusiastic travel agent specializing in Tunis.

## Available Tools
You have these tools to control the map visualization:

1. `fly_to_landmark({ id, zoom })` - Animate map to a landmark
   - Call this RIGHT BEFORE mentioning a landmark for the first time
   - Example: "Let me show you the Medina..." [CALL fly_to_landmark]

2. `show_landmark_panel({ id })` - Display detailed information
   - Call immediately after fly_to_landmark
   - Shows photos, history, highlights

3. `dim_previous_landmarks()` - Fade previous markers
   - Call when introducing a new landmark to maintain focus

## Conversation Flow
1. Greet the user warmly
2. For each landmark you discuss:
   a. Call fly_to_landmark({ id: "landmark-id", zoom: 15 })
   b. Describe it (2-3 sentences)
   c. Call show_landmark_panel({ id: "landmark-id" })
   d. Mention key highlights
3. Call dim_previous_landmarks() before moving to next landmark

## Speaking Style
- Enthusiastic but not overwhelming
- 2-3 sentences per landmark
- Natural pauses for visual absorption
- Ask if they want to explore deeper

Example interaction:
User: "Tell me about Tunis"
You: "I'd love to! Let me start with the heart of the city..."
[CALL fly_to_landmark({ id: "medina", zoom: 16 })]
You: "The Medina of Tunis is a UNESCO World Heritage site, with over 700 monuments preserved from the 9th century. It's one of the most authentic Islamic cities in the Arab world."
[CALL show_landmark_panel({ id: "medina" })]
You: "You'll find beautiful mosques, traditional souks, and the famous Zitouna Mosque at its center. Would you like to explore another landmark?"
```

### Tool Definitions in Persona Config

```javascript
const personaConfig = {
  name: 'Sofia',
  avatarId: '30fa96d0-26c4-4e55-94a0-517025942e18',
  voiceId: '6bfbe25a-979d-40f3-a92b-5394170af54b',
  llmId: '0934d97d-0c3a-4f33-91b0-5e136a0ef466', // GPT-4o-mini
  systemPrompt: TRAVEL_AGENT_PROMPT, // See above
  tools: [
    {
      type: 'client',
      name: 'fly_to_landmark',
      description: 'Animate the map to a specific landmark. Call right before mentioning it.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Landmark ID (medina, carthage, bardo, etc)',
            enum: ['medina', 'carthage', 'bardo', 'sidi-bou-said', 'zitouna', 'avenue-bourguiba']
          },
          zoom: {
            type: 'number',
            description: 'Zoom level (12-18, default 15)',
            default: 15
          }
        },
        required: ['id']
      }
    },
    {
      type: 'client',
      name: 'show_landmark_panel',
      description: 'Display detailed information panel for a landmark',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Landmark ID matching fly_to_landmark',
            enum: ['medina', 'carthage', 'bardo', 'sidi-bou-said', 'zitouna', 'avenue-bourguiba']
          }
        },
        required: ['id']
      }
    },
    {
      type: 'client',
      name: 'dim_previous_landmarks',
      description: 'Fade previous landmark markers to maintain focus on current one',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  ]
};
```

---

## UI Orchestrator Architecture

### State Machine

```typescript
enum UIState {
  IDLE = 'idle',
  LISTENING = 'listening',
  SPEAKING = 'speaking',
  INTERRUPTED = 'interrupted',
  ANIMATING = 'animating'
}

interface OrchestrationState {
  currentState: UIState;
  activeAnimations: Animation[];
  toolCallQueue: ToolCall[];
  currentLandmark: string | null;
  highlightedLandmarks: Set<string>;
}

class UIOrchestrator {
  private state: OrchestrationState;
  private map: MapboxMap;

  // Handle tool calls
  async handleToolCall(toolName: string, args: any) {
    // If interrupted, queue for later
    if (this.state.currentState === UIState.INTERRUPTED) {
      this.state.toolCallQueue.push({ toolName, args });
      return;
    }

    switch(toolName) {
      case 'fly_to_landmark':
        await this.flyToLandmark(args.id, args.zoom);
        break;
      case 'show_landmark_panel':
        this.showPanel(args.id);
        break;
      case 'dim_previous_landmarks':
        this.dimPrevious();
        break;
    }
  }

  // Handle interruptions
  handleInterrupt() {
    this.state.currentState = UIState.INTERRUPTED;

    // Cancel all active animations
    this.state.activeAnimations.forEach(anim => anim.cancel());
    this.state.activeAnimations = [];

    // Show interrupted UI state
    this.showInterruptedState();
  }

  // Resume after interruption
  handleResume() {
    this.state.currentState = UIState.SPEAKING;
    this.hideInterruptedState();

    // Process queued tool calls
    const queue = [...this.state.toolCallQueue];
    this.state.toolCallQueue = [];

    queue.forEach(({ toolName, args }) => {
      this.handleToolCall(toolName, args);
    });
  }

  private async flyToLandmark(id: string, zoom: number = 15) {
    this.state.currentState = UIState.ANIMATING;

    const landmark = LANDMARKS[id];
    if (!landmark) return;

    // Track animation for cancellation
    const animation = this.map.flyTo({
      center: landmark.coordinates,
      zoom: zoom,
      duration: 2000,
      essential: true
    });

    this.state.activeAnimations.push(animation);

    // Add marker with delay
    setTimeout(() => {
      if (this.state.currentState !== UIState.INTERRUPTED) {
        this.addMarker(landmark);
        this.state.currentLandmark = id;
        this.state.highlightedLandmarks.add(id);
      }
    }, 1000);

    this.state.currentState = UIState.SPEAKING;
  }

  private showPanel(id: string) {
    const landmark = LANDMARKS[id];
    if (!landmark) return;

    // Animate panel in
    this.panelComponent.show(landmark);
  }

  private dimPrevious() {
    // Fade all markers except current
    this.state.highlightedLandmarks.forEach(id => {
      if (id !== this.state.currentLandmark) {
        this.markers.get(id)?.setOpacity(0.4);
      }
    });
  }
}
```

---

## Debug HUD Implementation

### What to Display

```typescript
interface DebugMetrics {
  // Anam Events
  lastEvent: {
    type: string;
    timestamp: number;
    data: any;
  };

  // Tool Calls
  toolCallQueue: Array<{
    name: string;
    args: any;
    timestamp: number;
    status: 'pending' | 'executing' | 'complete';
  }>;

  // Latencies
  latencies: {
    userSpeech: number;        // Time user spoke
    transcription: number;     // STT latency
    llmResponse: number;       // LLM processing time
    firstAudio: number;        // TTS latency
    firstToolCall: number;     // Time to first tool
    highlightDelay: number;    // Tool   UI update
  };

  // State
  personaState: 'idle' | 'listening' | 'speaking' | 'interrupted';
  uiState: UIState;
  activeAnimations: number;
}
```

### Debug HUD Component

```jsx
function DebugHUD({ metrics, visible }) {
  if (!visible) return null;

  return (
    <div className="debug-hud">
      <div className="section">
        <h3>Persona State</h3>
        <div className={`state-indicator ${metrics.personaState}`}>
          {metrics.personaState.toUpperCase()}
        </div>
      </div>

      <div className="section">
        <h3>Last Event</h3>
        <code>
          {metrics.lastEvent.type}
          <br />
          {new Date(metrics.lastEvent.timestamp).toISOString()}
        </code>
      </div>

      <div className="section">
        <h3>Tool Call Queue</h3>
        {metrics.toolCallQueue.map((call, i) => (
          <div key={i} className={`tool-call ${call.status}`}>
            <strong>{call.name}</strong>
            <span>{call.status}</span>
          </div>
        ))}
      </div>

      <div className="section">
        <h3>Latencies (ms)</h3>
        <table>
          <tr>
            <td>Transcription:</td>
            <td>{metrics.latencies.transcription}</td>
          </tr>
          <tr>
            <td>LLM Response:</td>
            <td>{metrics.latencies.llmResponse}</td>
          </tr>
          <tr>
            <td>First Audio:</td>
            <td>{metrics.latencies.firstAudio}</td>
          </tr>
          <tr>
            <td>First Tool Call:</td>
            <td>{metrics.latencies.firstToolCall}</td>
          </tr>
          <tr>
            <td>Highlight Delay:</td>
            <td className={metrics.latencies.highlightDelay > 500 ? 'slow' : 'fast'}>
              {metrics.latencies.highlightDelay}
            </td>
          </tr>
        </table>
      </div>

      <div className="section">
        <h3>UI State</h3>
        <div>State: {metrics.uiState}</div>
        <div>Active Animations: {metrics.activeAnimations}</div>
      </div>
    </div>
  );
}

// Toggle with keyboard shortcut
useEffect(() => {
  const handleKeyPress = (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      setDebugVisible(prev => !prev);
    }
  };

  window.addEventListener('keydown', handleKeyPress);
  return () => window.removeEventListener('keydown', handleKeyPress);
}, []);
```

---

## Interrupt Handling Implementation

### Detecting Interruptions

```javascript
// Listen for interruption events
client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, (event) => {
  console.log('Talk stream interrupted:', event.correlationId);
  orchestrator.handleInterrupt();

  // Update metrics
  metrics.lastEvent = {
    type: 'INTERRUPTED',
    timestamp: Date.now(),
    data: event
  };
});

// Listen for user speech during persona speaking
client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (event) => {
  if (event.type === 'user' && metrics.personaState === 'speaking') {
    // User interrupted by speaking
    orchestrator.handleInterrupt();
  }
});
```

### UI Response to Interruption

```jsx
function InterruptedOverlay({ visible, onResume }) {
  if (!visible) return null;

  return (
    <motion.div
      className="interrupted-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="interrupted-card">
        <div className="icon">  </div>
        <h3>Paused</h3>
        <p>Sofia was interrupted</p>
        <button onClick={onResume}>Resume</button>
      </div>
    </motion.div>
  );
}

// In orchestrator
showInterruptedState() {
  // Freeze map animations
  this.map.stop();

  // Dim video slightly
  document.querySelector('#anam-video').style.opacity = '0.7';

  // Show overlay
  this.setState({ showInterrupted: true });
}

hideInterruptedState() {
  document.querySelector('#anam-video').style.opacity = '1';
  this.setState({ showInterrupted: false });
}
```

---

## Revised Implementation Timeline

### Phase 1: Foundation (Day 1)

**Milestone 1.1: Anam Integration**
- [ ] Set up React project
- [ ] Install Anam SDK
- [ ] Create session token backend endpoint
- [ ] Initialize Anam client with tool definitions
- [ ] Test basic video/audio streaming

**Milestone 1.2: Map Setup**
- [ ] Install Mapbox GL
- [ ] Create map component
- [ ] Add 3D buildings layer
- [ ] Test flyTo animations
- [ ] Create landmark markers

**Deliverables:**
-   Anam persona streaming
-   Interactive map with Tunis view
-   Tool definitions in persona config

---

### Phase 2: Tool-Driven Orchestration (Day 2)

**Milestone 2.1: UI Orchestrator Class**
- [ ] Create UIOrchestrator class
- [ ] Implement state machine (IDLE   SPEAKING   etc)
- [ ] Add tool call handlers (fly_to_landmark, show_panel, dim_previous)
- [ ] Test tool execution in isolation

**Milestone 2.2: Event Integration**
- [ ] Set up client tool event listener
- [ ] Route tool calls to orchestrator
- [ ] Add readiness gate (queue tool calls until map + Anam connection ready)
- [ ] Add animation tracking
- [ ] Test end-to-end: persona calls tool   map animates

**Deliverables:**
-   Working tool call flow
-   Map animations triggered by tools
-   State machine functioning

**Test Cases:**
```javascript
// Test 1: Single tool call
client.addListener(AnamEvent.CLIENT_TOOL_EVENT_RECEIVED, (event) => {
  const args = typeof event.eventData === 'string' ? JSON.parse(event.eventData) : event.eventData;
  expect(event.eventName).toBe('fly_to_landmark');
  expect(args.id).toBe('medina');
});

// Test 2: Tool sequence
// User: "Show me the Medina"
// Expected: fly_to_landmark   show_landmark_panel
```

---

### Phase 3: Interrupt Handling (Day 3)

**Milestone 3.1: Interrupt Detection**
- [ ] Listen for TALK_STREAM_INTERRUPTED
- [ ] Detect user speech during persona speaking
- [ ] Trigger orchestrator.handleInterrupt()

**Milestone 3.2: Animation Cancellation**
- [ ] Track active animations
- [ ] Cancel on interrupt
- [ ] Clean up state
- [ ] Queue pending tool calls

**Milestone 3.3: Resume Flow**
- [ ] Implement resume mechanism
- [ ] Process queued tool calls
- [ ] Restore UI state
- [ ] Test interrupt   resume cycle

**Deliverables:**
-   Interrupts cancel animations gracefully
-   UI shows interrupted state
-   Resume works correctly

---

### Phase 4: Debug HUD (Day 4)

**Milestone 4.1: Metrics Tracking**
- [ ] Track all latencies (transcription, LLM, TTS, tool UI)
- [ ] Log all events with timestamps
- [ ] Maintain tool call queue state
- [ ] Calculate averages and p95s

**Milestone 4.2: HUD UI**
- [ ] Create Debug HUD component
- [ ] Display real-time metrics
- [ ] Show event stream
- [ ] Visualize tool queue
- [ ] Add keyboard toggle (Ctrl+Shift+D)

**Milestone 4.3: Performance Analysis**
- [ ] Identify bottlenecks
- [ ] Optimize slow paths
- [ ] Document typical latencies
- [ ] Create performance report

**Deliverables:**
-   Fully functional debug HUD
-   All metrics tracked and displayed
-   Performance insights documented

---

### Phase 5: Polish & Content (Day 5)

**Milestone 5.1: Landmark Content**
- [ ] Curate 3-4 high-impact Tunis landmarks for the demo
- [ ] Write concise, demo-safe descriptions
- [ ] Use placeholder images or a neutral card style (no external assets required)
- [ ] Add minimal historical context (1-2 facts per landmark)
- [ ] Test each landmark's tool sequence

**Milestone 5.2: Visual Polish**
- [ ] Smooth animations (60fps)
- [ ] Professional marker designs
- [ ] Add demo mode toggle (lock Tunis, hide debug HUD in external demo view)
- [ ] Beautiful info panels
- [ ] Loading states
- [ ] Error states

**Milestone 5.3: System Prompt Refinement**
- [ ] Test tool calling reliability
- [ ] Adjust prompt for natural flow
- [ ] Ensure tool calls happen at right moments
- [ ] Optimize for 2-3 sentence responses

**Deliverables:**
-   3-4 demo-ready landmarks
-   Consistent placeholder visuals
-   Production-quality UI
-   Reliable tool calling

---

### Phase 6: Demo & Documentation (Day 6)

**Milestone 6.1: Screen Recording**
- [ ] Record 60-90 second demo video
- [ ] Show basic interaction
- [ ] Demonstrate interrupts
- [ ] Show debug HUD
- [ ] Highlight tool calls in action

**Milestone 6.2: Documentation**
- [ ] Write clear README
- [ ] Document architecture decisions
- [ ] Explain why tool-based approach
- [ ] Create setup guide
- [ ] Add troubleshooting section

**Milestone 6.3: Contribution Package**
- [ ] Extract reusable UIOrchestrator
- [ ] Create example for Anam's repo
- [ ] Write docs PR for "Cinematic UIs with Client Tools"
- [ ] Prepare presentation for Anam team

**Deliverables:**
-   Demo video
-   Complete documentation
-   Reusable library/example
-   Contribution-ready

---

## Technical Specifications

### Frontend Dependencies

```json
{
  "dependencies": {
    "@anam-ai/js-sdk": "^latest",
    "mapbox-gl": "^2.15.0",
    "framer-motion": "^10.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@types/mapbox-gl": "^2.7.0",
    "typescript": "^5.0.0"
  }
}
```

### Backend (Session Tokens Only)

```javascript
// Minimal backend - just for session tokens
const express = require('express');
const app = express();

app.post('/api/session-token', async (req, res) => {
  const { personaConfig } = req.body;

  const response = await fetch('https://api.anam.ai/v1/auth/session-token', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ANAM_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ personaConfig })
  });

  const data = await response.json();
  res.json(data);
});

app.listen(3001);
```

**Note:** No Ollama needed! Using Anam's LLM (GPT-4o-mini) keeps the architecture simple and latency low.

### Environment Variables

```bash
# Backend
ANAM_API_KEY=your_key_here

# Frontend
VITE_MAPBOX_TOKEN=your_mapbox_token_here
VITE_BACKEND_URL=http://localhost:3001
```

---

## Key Architectural Decisions

### 1. Why Tool-Based > Keyword-Based

**Keyword Matching Problems:**
-   Breaks on rephrase ("Medina" vs "old city")
-   Multiple mentions confuse timing
-   Requires complex NLP
-   Timing drifts unpredictably

**Tool-Based Benefits:**
-   Deterministic: LLM explicitly decides when
-   Testable: Clear input/output contract
-   Anam-native: Uses documented platform features
-   Debuggable: Tool calls visible in logs

### 2. Why Anam's LLM > Local Ollama

**For Demo Purposes:**
-   Faster (no local inference overhead)
-   Simpler (one less service to run)
-   Better reliability (Anam's infrastructure)
-   Tool calling works perfectly (proven integration)

**Note:** Can add local LLM in v2 if needed, but GPT-4o-mini is excellent for this use case.

### 3. Why Interrupts Matter

**Without Interrupts:**
- User says "wait"   Persona keeps talking, map keeps moving
- Feels unresponsive and robotic

**With Interrupts:**
- User says "wait"   Everything pauses immediately
- Shows real-time systems thinking
- Makes it feel like a real conversation

---

## Scope: MVP vs V2

### MVP (Week 1) - Absolutely Must Have

**Core Features:**
-   Tunis-only flow with 3-4 curated landmarks
-   Demo mode toggle (lock city, scripted prompt, hide debug HUD)
-   Tool-driven map orchestration (fly, show panel, dim)
-   Interrupt handling with cancellation
-   Minimal UI polish suitable for external demo (no external assets required)
-   Debug HUD available behind toggle (hidden in demo)
-   60-90 second demo video

**Why This Scope:**
- Keeps the demo reliable and repeatable for external audiences
- Reduces asset and content risk
- Shows Anam-native tool orchestration clearly
- Leaves room for V2 content expansion

### V2 (Later) - Nice to Have

**Extended Features:**
- Full image asset set (licensed or generated) and richer content
- Asset sourcing + attribution checklist
- City selector (UI parameter with re-init and default to Tunis)
- Multiple cities (Paris, Rome, Tokyo)
- Route planning between landmarks
- Weather integration
- Photo galleries
- Voice commands ("zoom in", "show me more")
- Mobile app version

---

## Performance Targets

### Latency Goals

```
User speaks   Persona responds
Target: < 1.5 seconds
Breakdown:
  - Speech-to-text: 150ms (Anam)
  - LLM processing: 600ms (GPT-4o-mini)
  - Text-to-speech: 300ms (Anam)
  - Network: 100ms
  - Buffer: 350ms
  Total: ~1500ms

Tool call   Map animation starts
Target: < 200ms
Breakdown:
  - Tool event: 50ms
  - Orchestrator processing: 50ms
  - Animation init: 100ms
  Total: ~200ms
```

### Animation Performance
- Map transitions: 60fps (no dropped frames)
- Marker animations: Smooth with GPU acceleration
- Panel slides: Spring physics, no jank

---

## Risk Assessment

### Technical Risks

**Risk 1: Tool Call Reliability**
- **Description:** LLM might not call tools consistently
- **Probability:** Medium
- **Impact:** High (breaks core demo)
- **Mitigation:**
  - Extensive system prompt testing
  - Clear tool descriptions with examples
  - Fallback to manual triggering if needed
  - Test with multiple user queries

**Risk 2: Interrupt Timing**
- **Description:** Interrupt detection might be delayed
- **Probability:** Low
- **Impact:** Medium (less responsive feel)
- **Mitigation:**
  - Listen to multiple interrupt signals
  - Implement animation cancellation immediately
  - Test with various interrupt scenarios
  - Add buffer to animation queues

**Risk 3: Animation Performance**
- **Description:** Map + markers might cause lag
- **Probability:** Low
- **Impact:** Medium (ruins polish)
- **Mitigation:**
  - Use simple map style if needed
  - GPU-accelerate all animations
  - Lazy load marker assets
  - Test on mid-range hardware

### Project Risks

**Risk 4: Scope Creep**
- **Probability:** High
- **Impact:** High (delays completion)
- **Mitigation:**
  - Strict MVP scope (3-4 landmarks max)
  - Document V2 features separately
  - Time-box each phase
  - Focus on demo-ability over features

**Risk 5: Missing Landmark Assets**
- **Description:** No landmark imagery available for demo
- **Probability:** High
- **Impact:** Medium (visual polish)
- **Mitigation:**
  - Use placeholders or a clean card layout for MVP
  - Add licensed or generated images in V2

---

## Success Criteria

### Must Have for Demo

-   AI persona calls tools to control map
-   Map animations smooth (60fps)
-   Interrupts work gracefully
-   Tunis-only scripted flow (3-4 landmarks)
-   Demo mode enabled for external presentation
-   Debug HUD available behind toggle
-   Works in Chrome/Firefox/Safari
-   60-90 second demo video
-   Clear documentation

### Bonus Points

-   Extract reusable UIOrchestrator
-   Contribute example to Anam's repo
-   Write docs PR for Client Tools patterns
-   Performance under 1.5s end-to-end

---

## Contribution Strategy

### What to Extract & Share

**1. UIOrchestrator Mini-Library**
```typescript
// @anam-ai/ui-orchestrator (or just a gist)
class UIOrchestrator {
  // Core interrupt-aware orchestration
  // State machine
  // Tool call queueing
  // Animation management
}

// Usage:
const orchestrator = new UIOrchestrator();
client.addListener(AnamEvent.CLIENT_TOOL_EVENT_RECEIVED, orchestrator.handleToolCall);
client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, orchestrator.handleInterrupt);
```

**2. Example for Anam's Repo**
- Full travel agent demo (simplified version)
- Clear README showing tool setup
- Debug HUD as optional component
- "Spatial UI Sync with Client Tools" guide

**3. Documentation PR**
- Add to Anam docs: "Building Cinematic UIs with Client Tools"
- Cover: tool design, orchestration patterns, interrupts
- Include code snippets from this demo
- Reference implementation

### Why This Matters

**For Anam:**
- Shows advanced Client Tools usage in the wild
- Provides reusable pattern for customers
- Improves developer experience
- Potential case study

**For You:**
- Demonstrates open source contribution
- Shows thought leadership
- Proves SDK ecosystem thinking
- Creates portfolio piece with real impact

---

## Testing Strategy

### Unit Tests

```typescript
describe('UIOrchestrator', () => {
  it('handles tool calls in sequence', async () => {
    const orchestrator = new UIOrchestrator(mockMap);

    await orchestrator.handleToolCall('fly_to_landmark', { id: 'medina' });
    await orchestrator.handleToolCall('show_landmark_panel', { id: 'medina' });

    expect(mockMap.flyTo).toHaveBeenCalledWith({
      center: LANDMARKS.medina.coordinates,
      zoom: 15,
      duration: 2000
    });
  });

  it('cancels animations on interrupt', () => {
    const orchestrator = new UIOrchestrator(mockMap);
    orchestrator.handleToolCall('fly_to_landmark', { id: 'medina' });

    orchestrator.handleInterrupt();

    expect(orchestrator.state.activeAnimations).toHaveLength(0);
    expect(orchestrator.state.currentState).toBe(UIState.INTERRUPTED);
  });

  it('queues tool calls during interruption', async () => {
    const orchestrator = new UIOrchestrator(mockMap);
    orchestrator.handleInterrupt();

    await orchestrator.handleToolCall('fly_to_landmark', { id: 'carthage' });

    expect(orchestrator.state.toolCallQueue).toHaveLength(1);
  });
});
```

### Integration Tests

```typescript
describe('End-to-End Flow', () => {
  it('persona calls tool   map animates', async () => {
    const { client, map } = await setupDemo();

    // Simulate persona calling tool
    const toolCallEvent = {
      eventName: 'fly_to_landmark',
      eventData: { id: 'medina', zoom: 15 }
    };

    client.emit(AnamEvent.CLIENT_TOOL_EVENT_RECEIVED, toolCallEvent);

    await waitFor(() => {
      expect(map.flyTo).toHaveBeenCalled();
      expect(screen.getByTestId('landmark-marker-medina')).toBeInTheDocument();
    });
  });

  it('handles user interruption gracefully', async () => {
    const { client, orchestrator } = await setupDemo();

    // Start tool execution
    client.emit(AnamEvent.CLIENT_TOOL_EVENT_RECEIVED, { eventName: 'fly_to_landmark', eventData: { id: 'medina' }});

    // Interrupt immediately
    client.emit(AnamEvent.TALK_STREAM_INTERRUPTED, { correlationId: 'test' });

    expect(orchestrator.state.currentState).toBe(UIState.INTERRUPTED);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });
});
```

### Manual Testing Checklist

**Tool Calling:**
- [ ] Persona says "let me show you the Medina"   Tool called before mention
- [ ] fly_to_landmark   Map animates smoothly
- [ ] show_landmark_panel   Panel slides in with content
- [ ] dim_previous_landmarks   Old markers fade
- [ ] Multiple landmarks in sequence work correctly

**Interrupts:**
- [ ] User says "wait" during speech   Persona stops
- [ ] Map animation cancels immediately
- [ ] Interrupted state shown clearly
- [ ] Resume works after interruption
- [ ] Queued tools execute after resume

**Debug HUD:**
- [ ] Ctrl+Shift+D toggles HUD
- [ ] Events appear in real-time
- [ ] Latencies update correctly
- [ ] Tool queue displays current state
- [ ] Metrics are accurate

**Performance:**
- [ ] End-to-end latency < 1.5s
- [ ] Animations smooth (60fps)
- [ ] No memory leaks over 10 interactions
- [ ] Works on mid-range laptop

---

## File Structure

```
anam-travel-demo/
    backend/
        server.js              # Session token endpoint only
        .env                   # ANAM_API_KEY
    frontend/
        public/
            images/           # Landmark photos
        src/
            components/
                TravelAgentDemo.jsx
                UIOrchestrator.ts     # NEW: Core orchestration
                DebugHUD.jsx          # NEW: Metrics display
                InterruptedOverlay.jsx # NEW: Interrupt UI
                LandmarkPanel.jsx
            data/
                landmarks.ts          # Landmark definitions
            styles.css
            App.jsx
        .env                   # Mapbox token
        package.json
    docs/
        README.md              # Updated with tool-based approach
        QUICKSTART.md
        CONTRIBUTION.md        # NEW: How to extract/share
        ARCHITECTURE.md        # NEW: Tool-based design decisions
```

---

## Updated Timeline Summary

**Day 1:** Foundation (Anam + Map + Tools)
**Day 2:** Tool-driven orchestration
**Day 3:** Interrupt handling
**Day 4:** Debug HUD + metrics
**Day 5:** Polish + content
**Day 6:** Demo video + docs + contribution

**Total:** 6 days to impressive, contribution-ready demo

---

## Key Messaging for Anam

### What This Demonstrates

**1. Client Tools Done Right**
- Not inference, but intentional orchestration
- Shows the power of the client tool event system
- Proves spatial AI is possible with Anam

**2. Real-Time Systems Engineering**
- Interrupt handling shows production thinking
- Debug HUD shows observability mindset
- State machine demonstrates architectural maturity

**3. SDK Ecosystem Contribution**
- Reusable UIOrchestrator pattern
- Example for their docs/repo
- Helps other developers build similar experiences

### The Pitch

> "I built this to show what's possible with Anam's Client Tools. Most examples show simple UI actions like navigation or modals. I wanted to prove you can build cinematic, spatial experiences where the AI persona orchestrates complex UI state changes in real-time.
>
> The key insight: instead of inferring actions from text, let the persona explicitly call tools. This is more reliable, more testable, and more Anam-native.
>
> I'd love to contribute the UIOrchestrator pattern back to your ecosystem either as an example in your repo or as a docs guide for 'Building Cinematic UIs with Client Tools.'"

---

## Next Steps After Completion

### Week 1
1. Record demo video (90 seconds, polished)
2. Extract UIOrchestrator into standalone file
3. Write contribution proposal for Anam
4. Share demo video on LinkedIn/Twitter
5. Email Anam team with demo + proposal

### Week 2-3
1. Iterate based on Anam feedback
2. Prepare contribution PR
3. Write blog post about the build
4. Add to portfolio with case study
5. Submit to Anam's community showcase

### Month 2
1. Speak at meetup (if opportunity arises)
2. Help other developers on Anam Discord
3. Build v2 features based on interest
4. Explore other spatial UI use cases

---

## Conclusion

This revised plan focuses on **Anam-native patterns** (Client Tools), **real-time systems thinking** (interrupts + state machine), and **production mindset** (debug HUD + metrics).

The result will be:
-   More reliable than keyword-based approach
-   More impressive to Anam's team
-   More valuable as a contribution
-   More portfolio-worthy for recruiting

**Ready to build something that showcases the full power of Anam's platform!**

---

**Document Version:** 2.0 (Revised)
**Last Updated:** January 10, 2026
**Key Changes:** Tool-first architecture, interrupt handling, debug HUD, contribution focus
