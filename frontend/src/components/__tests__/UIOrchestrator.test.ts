import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIOrchestrator, UIState } from '../UIOrchestrator';
import { getLandmarksByCity } from '../../data/landmarks';

vi.mock('mapbox-gl', () => {
  class Marker {
    element: HTMLElement;
    constructor(element: HTMLElement) {
      this.element = element;
    }
    setLngLat() {
      return this;
    }
    setPopup() {
      return this;
    }
    addTo() {
      return this;
    }
    togglePopup() {
      return this;
    }
    getElement() {
      return this.element;
    }
    remove() {
      return this;
    }
  }

  class Popup {
    setHTML() {
      return this;
    }
  }

  return {
    default: { Marker, Popup },
    Marker,
    Popup
  };
});

const createMapMock = () => ({
  flyTo: vi.fn(),
  isMoving: vi.fn(() => false),
  stop: vi.fn()
});

describe('UIOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queues tool calls until ready', async () => {
    const map = createMapMock();
    const setCurrentLandmark = vi.fn();
    const setUIState = vi.fn();
    const showMediaOverlay = vi.fn();
    const setShowInterrupted = vi.fn();
    const updateMetrics = vi.fn();
    const landmarks = getLandmarksByCity('tunis');

    const orchestrator = new UIOrchestrator(
      map as any,
      landmarks,
      'Tunis',
      setCurrentLandmark,
      setUIState,
      showMediaOverlay,
      setShowInterrupted,
      updateMetrics
    );

    await orchestrator.handleToolCall('fly_to_landmark', { id: 'medina', zoom: 15 });
    expect(orchestrator.currentState.toolCallQueue.length).toBe(1);

    orchestrator.setReady(true);
    expect(map.flyTo).toHaveBeenCalled();
  });

  it('queues tools during interrupt and resumes', async () => {
    const map = createMapMock();
    const setCurrentLandmark = vi.fn();
    const setUIState = vi.fn();
    const showMediaOverlay = vi.fn();
    const setShowInterrupted = vi.fn();
    const updateMetrics = vi.fn();
    const landmarks = getLandmarksByCity('tunis');

    const orchestrator = new UIOrchestrator(
      map as any,
      landmarks,
      'Tunis',
      setCurrentLandmark,
      setUIState,
      showMediaOverlay,
      setShowInterrupted,
      updateMetrics
    );

    orchestrator.setReady(true);
    orchestrator.handleInterrupt();

    await orchestrator.handleToolCall('show_landmark_panel', { id: 'medina' });
    expect(orchestrator.currentState.toolCallQueue.length).toBe(1);

    orchestrator.handleResume();
    expect(orchestrator.currentState.currentState).toBe(UIState.SPEAKING);
  });
});
