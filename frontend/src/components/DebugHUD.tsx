import React from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import './DebugHUD.css';

interface DebugMetrics {
  lastEvent: {
    type: string;
    timestamp: number;
    data: any;
  } | null;
  toolCallQueue: Array<{
    name: string;
    args: any;
    timestamp: number;
    status: 'pending' | 'executing' | 'complete';
  }>;
  latencies: {
    transcription?: number;
    llmResponse?: number;
    firstAudio?: number;
    firstToolCall?: number;
    highlightDelay?: number;
  };
  personaState: string;
  uiState: string;
  activeAnimations: number;
}

interface DebugHUDProps {
  metrics: DebugMetrics;
  visible: boolean;
  enable3DBuildings?: boolean;
  onToggle3DBuildings?: () => void;
}

export const DebugHUD: React.FC<DebugHUDProps> = ({ metrics, visible, enable3DBuildings, onToggle3DBuildings }) => {
  const dragControls = useDragControls();
  const hudRef = React.useRef<HTMLDivElement>(null);

  if (!visible) return null;

  const formatTimestamp = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getStateColor = (state: string) => {
    switch (state.toLowerCase()) {
      case 'idle':
        return '#94a3b8';
      case 'listening':
        return '#3b82f6';
      case 'speaking':
        return '#10b981';
      case 'interrupted':
        return '#ef4444';
      case 'animating':
        return '#8b5cf6';
      default:
        return '#64748b';
    }
  };

  const getLatencyColor = (latency: number) => {
    if (latency < 200) return '#10b981'; // Green
    if (latency < 500) return '#f59e0b'; // Yellow
    return '#ef4444'; // Red
  };

  return (
    <motion.div
      ref={hudRef}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      className="debug-hud"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div
        className="debug-header"
        onPointerDown={(e) => dragControls.start(e)}
        style={{ cursor: 'grab' }}
      >
        <h2>Debug HUD</h2>
        <div className="debug-hint">Press Ctrl+Shift+D to toggle</div>
      </div>

      {/* Persona State */}
      <div className="debug-section">
        <h3>Persona State</h3>
        <div
          className="state-indicator"
          style={{ backgroundColor: getStateColor(metrics.personaState) }}
        >
          {metrics.personaState.toUpperCase()}
        </div>
      </div>

      {/* UI State */}
      <div className="debug-section">
        <h3>UI State</h3>
        <div className="state-info">
          <div
            className="state-badge"
            style={{ backgroundColor: getStateColor(metrics.uiState) }}
          >
            {metrics.uiState}
          </div>
          <div className="state-detail">
            Active Animations: <strong>{metrics.activeAnimations}</strong>
          </div>
        </div>
      </div>

      {/* Map Settings */}
      <div className="debug-section">
        <h3>Map Settings</h3>
        <label className="debug-checkbox">
          <input
            type="checkbox"
            checked={enable3DBuildings || false}
            onChange={onToggle3DBuildings}
          />
          <span>Enable 3D Buildings</span>
        </label>
      </div>

      {/* Last Event */}
      <div className="debug-section">
        <h3>Last Event</h3>
        {metrics.lastEvent ? (
          <div className="event-display">
            <div className="event-type">{metrics.lastEvent.type}</div>
            <div className="event-time">
              {formatTimestamp(metrics.lastEvent.timestamp)}
            </div>
            <details className="event-data">
              <summary>Event Data</summary>
              <pre>{JSON.stringify(metrics.lastEvent.data, null, 2)}</pre>
            </details>
          </div>
        ) : (
          <div className="no-data">No events yet</div>
        )}
      </div>

      {/* Tool Call Queue */}
      <div className="debug-section">
        <h3>Tool Call Queue</h3>
        {metrics.toolCallQueue.length > 0 ? (
          <div className="tool-queue">
            {metrics.toolCallQueue.slice(-5).map((call, i) => (
              <div key={i} className={`tool-call tool-call-${call.status}`}>
                <div className="tool-name">{call.name}</div>
                <div className="tool-status">{call.status}</div>
                <div className="tool-time">
                  {formatTimestamp(call.timestamp)}
                </div>
                {Object.keys(call.args).length > 0 && (
                  <details className="tool-args">
                    <summary>Arguments</summary>
                    <pre>{JSON.stringify(call.args, null, 2)}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="no-data">No tool calls yet</div>
        )}
      </div>

      {/* Latencies */}
      <div className="debug-section">
        <h3>Latencies (ms)</h3>
        <table className="latency-table">
          <tbody>
            {metrics.latencies.transcription !== undefined && (
              <tr>
                <td>Transcription:</td>
                <td style={{ color: getLatencyColor(metrics.latencies.transcription) }}>
                  {metrics.latencies.transcription}ms
                </td>
              </tr>
            )}
            {metrics.latencies.llmResponse !== undefined && (
              <tr>
                <td>LLM Response:</td>
                <td style={{ color: getLatencyColor(metrics.latencies.llmResponse) }}>
                  {metrics.latencies.llmResponse}ms
                </td>
              </tr>
            )}
            {metrics.latencies.firstAudio !== undefined && (
              <tr>
                <td>First Audio:</td>
                <td style={{ color: getLatencyColor(metrics.latencies.firstAudio) }}>
                  {metrics.latencies.firstAudio}ms
                </td>
              </tr>
            )}
            {metrics.latencies.firstToolCall !== undefined && (
              <tr>
                <td>First Tool Call:</td>
                <td style={{ color: getLatencyColor(metrics.latencies.firstToolCall) }}>
                  {metrics.latencies.firstToolCall}ms
                </td>
              </tr>
            )}
            {metrics.latencies.highlightDelay !== undefined && (
              <tr>
                <td>Highlight Delay:</td>
                <td style={{ color: getLatencyColor(metrics.latencies.highlightDelay) }}>
                  <strong>{metrics.latencies.highlightDelay}ms</strong>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {Object.keys(metrics.latencies).length === 0 && (
          <div className="no-data">No latency data yet</div>
        )}
      </div>

      {/* Performance Indicators */}
      <div className="debug-section">
        <h3>Performance</h3>
        <div className="performance-indicators">
          {metrics.latencies.highlightDelay !== undefined && (
            <div className="perf-indicator">
              <div className="perf-label">Tool to UI</div>
              <div
                className="perf-bar"
                style={{
                  width: `${Math.min(metrics.latencies.highlightDelay / 5, 100)}%`,
                  backgroundColor: getLatencyColor(metrics.latencies.highlightDelay)
                }}
              />
              <div className="perf-value">{metrics.latencies.highlightDelay}ms</div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

