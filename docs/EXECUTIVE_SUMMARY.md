# AI Travel Agent Demo - Executive Summary for Anam

## What I Built

An interactive travel agent experience where an AI persona (Sofia) describes Tunis while the map automatically zooms, highlights, and displays information about landmarks in sync with her speech. The persona uses Client Tools to trigger deterministic UI actions.

Demo video concept: User asks "Tell me about Tunis" -> Sofia speaks -> the map fly-to and info panels update in lockstep with tool calls.

---

## Why This Matters to Anam

### 1. Shows Client Tools as the primary orchestration layer

Instead of inferring UI actions from text, the persona explicitly calls tools (fly, show panel, dim), which is more reliable, testable, and Anam-native.

### 2. Demonstrates real-time UI coordination without text inference

The UI responds to tool calls and speech state directly, avoiding fragile keyword timing and keeping the demo deterministic.

### 3. Clean, low-latency architecture

The demo relies on Anam-hosted LLM and media generation, with only a minimal session-token backend. No local LLM or extra services are required.

---

## Technical Highlights

### Tool-Driven Synchronization

```javascript
client.addListener(AnamEvent.CLIENT_TOOL_EVENT_RECEIVED, (event) => {
  orchestrator.handleToolCall(event.eventName, event.eventData);
});
```

### Deterministic UI Choreography

Each landmark follows the same reliable sequence:
1. fly_to_landmark
2. short spoken description while the map animates
3. show_landmark_panel
4. dim_previous_landmarks before moving on

### Interrupt Handling and Observability

- User interruptions cancel map animations immediately.
- A debug HUD surfaces tool calls and UI state to prove synchronization.

---

## Stack Demonstration

**Anam Architecture**
- Event-driven communication
- WebRTC streaming
- Session token handling

**Frontend**
- Mapbox GL for spatial visualization
- Framer Motion for polished transitions
- React + TypeScript for maintainable UI

**Backend**
- Small token exchange server only

---

## Use Cases This Enables

1. Real Estate Tours
2. Museum Guides
3. Educational Map Narratives
4. Data and Analytics Walkthroughs

---

## Metrics and Performance Targets

User speaks -> STT -> LLM -> tool call -> UI update

Targets:
- Time to first word: under 1.5 seconds
- Tool call to map animation: under 200 ms

---

## Next Steps

1. Record a 60-90 second demo clip
2. Package the UI orchestration pattern for reuse
3. Share findings with the Anam team
