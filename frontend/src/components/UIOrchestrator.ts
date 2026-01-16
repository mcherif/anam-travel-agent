import mapboxgl from 'mapbox-gl';
import type { Landmark } from '../data/landmarks';

export enum UIState {
  IDLE = 'idle',
  LISTENING = 'listening',
  SPEAKING = 'speaking',
  INTERRUPTED = 'interrupted',
  ANIMATING = 'animating'
}

type LandmarkMap = Record<string, Landmark>;

type ToolCall = {
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
};

type OrchestrationState = {
  currentState: UIState;
  activeAnimations: Array<{ type: string; landmarkId: string }>;
  toolCallQueue: ToolCall[];
  currentLandmark: string | null;
  highlightedLandmarks: Set<string>;
  markers: Map<string, mapboxgl.Marker>;
};

export class UIOrchestrator {
  private state: OrchestrationState;
  private map: mapboxgl.Map;
  private landmarks: LandmarkMap;
  private setCurrentLandmark: (landmark: Landmark | null) => void;
  private setUIState: (state: UIState) => void;
  private showMediaOverlay: (id: string, kind: 'photo' | 'video') => void;
  private setShowInterrupted: (show: boolean) => void;
  private updateMetrics: (metrics: Record<string, unknown>) => void;
  private isReady: boolean;

  constructor(
    map: mapboxgl.Map,
    landmarks: LandmarkMap,
    setCurrentLandmark: (landmark: Landmark | null) => void,
    setUIState: (state: UIState) => void,
    showMediaOverlay: (id: string, kind: 'photo' | 'video') => void,
    setShowInterrupted: (show: boolean) => void,
    updateMetrics: (metrics: Record<string, unknown>) => void
  ) {
    this.map = map;
    this.landmarks = landmarks;
    this.setCurrentLandmark = setCurrentLandmark;
    this.setUIState = setUIState;
    this.showMediaOverlay = showMediaOverlay;
    this.setShowInterrupted = setShowInterrupted;
    this.updateMetrics = updateMetrics;
    this.isReady = false;

    this.state = {
      currentState: UIState.IDLE,
      activeAnimations: [],
      toolCallQueue: [],
      currentLandmark: null,
      highlightedLandmarks: new Set(),
      markers: new Map()
    };
  }

  setReady(isReady: boolean): void {
    this.isReady = isReady;

    if (!isReady || this.state.currentState === UIState.INTERRUPTED) {
      return;
    }

    if (this.state.toolCallQueue.length > 0) {
      const queue = [...this.state.toolCallQueue];
      this.state.toolCallQueue = [];
      queue.forEach(({ toolName, args }) => this.handleToolCall(toolName, args));
    }
  }

  async handleToolCall(toolName: string, args: Record<string, unknown>): Promise<void> {
    if (this.state.currentState === UIState.INTERRUPTED || !this.isReady) {
      this.state.toolCallQueue.push({
        toolName,
        args,
        timestamp: Date.now()
      });
      return;
    }

    switch (toolName) {
      case 'fly_to_landmark':
        await this.flyToLandmark(String(args.id), Number(args.zoom) || 15);
        break;
      case 'show_landmark_panel':
        this.showLandmarkPanel(String(args.id));
        break;
      case 'dim_previous_landmarks':
        this.dimPreviousLandmarks();
        break;
      case 'show_media':
        this.showMedia(String(args.id), String(args.kind));
        break;
      default:
        console.warn(`[Orchestrator] Unknown tool: ${toolName}`);
    }
  }

  handleInterrupt(): void {
    this.state.currentState = UIState.INTERRUPTED;
    this.setUIState(UIState.INTERRUPTED);

    if (this.map.isMoving()) {
      this.map.stop();
    }

    this.state.activeAnimations = [];
    this.setShowInterrupted(true);

    const video = document.querySelector('#anam-video') as HTMLVideoElement | null;
    if (video) {
      video.style.opacity = '0.7';
    }

    this.updateMetrics({
      uiState: UIState.INTERRUPTED,
      activeAnimations: 0
    });
  }

  handleResume(): void {
    this.state.currentState = UIState.SPEAKING;
    this.setUIState(UIState.SPEAKING);
    this.setShowInterrupted(false);

    const video = document.querySelector('#anam-video') as HTMLVideoElement | null;
    if (video) {
      video.style.opacity = '0.7';
    }

    const queue = [...this.state.toolCallQueue];
    this.state.toolCallQueue = [];
    queue.forEach(({ toolName, args }) => this.handleToolCall(toolName, args));

    this.updateMetrics({
      uiState: UIState.SPEAKING,
      toolCallQueue: []
    });
  }

  private async flyToLandmark(id: string, zoom: number): Promise<void> {
    const landmark = this.landmarks[id];
    if (!landmark) {
      console.error(`[Orchestrator] Landmark not found: ${id}`);
      return;
    }

    this.state.currentState = UIState.ANIMATING;
    this.setUIState(UIState.ANIMATING);

    const resolvedZoom = Number.isFinite(zoom) ? zoom : landmark.zoom;

    this.map.flyTo({
      center: landmark.coordinates,
      zoom: resolvedZoom,
      duration: 2000,
      essential: true,
      pitch: 70,
      bearing: -15,
      easing: (t) => t * (2 - t)
    });

    this.state.activeAnimations.push({ type: 'flyTo', landmarkId: id });

    setTimeout(() => {
      if (this.state.currentState !== UIState.INTERRUPTED) {
        this.addMarker(landmark);
        this.state.currentLandmark = id;
        this.state.highlightedLandmarks.add(id);
        this.setCurrentLandmark(landmark);
      }
    }, 1000);

    setTimeout(() => {
      if (this.state.currentState === UIState.ANIMATING) {
        this.state.currentState = UIState.SPEAKING;
        this.setUIState(UIState.SPEAKING);
      }
      this.state.activeAnimations = this.state.activeAnimations.filter(
        (anim) => !(anim.type === 'flyTo' && anim.landmarkId === id)
      );
    }, 2000);

    this.updateMetrics({
      uiState: UIState.ANIMATING,
      activeAnimations: this.state.activeAnimations.length
    });
  }

  private showLandmarkPanel(id: string): void {
    const landmark = this.landmarks[id];
    if (!landmark) {
      console.error(`[Orchestrator] Landmark not found: ${id}`);
      return;
    }

    this.setCurrentLandmark(landmark);
  }

  private showMedia(id: string, kind: string): void {
    const landmark = this.landmarks[id];
    if (!landmark) {
      console.error(`[Orchestrator] Landmark not found: ${id}`);
      return;
    }

    const resolvedKind = kind === 'video' ? 'video' : 'photo';
    this.setCurrentLandmark(landmark);
    this.showMediaOverlay(id, resolvedKind);
  }

  private dimPreviousLandmarks(): void {
    this.state.highlightedLandmarks.forEach((landmarkId) => {
      if (landmarkId !== this.state.currentLandmark) {
        const marker = this.state.markers.get(landmarkId);
        if (marker) {
          const element = marker.getElement();
          element.style.opacity = '0.4';
        }
      }
    });
  }

  private addMarker(landmark: Landmark): void {
    if (this.state.markers.has(landmark.id)) {
      return;
    }

    const el = document.createElement('div');
    el.className = 'landmark-marker';
    el.innerHTML = `
      <div class="marker-pulse"></div>
      <div class="marker-icon">*</div>
    `;

    const marker = new mapboxgl.Marker(el)
      .setLngLat(landmark.coordinates)
      .setPopup(
        new mapboxgl.Popup({ offset: 25 }).setHTML(`
          <div class="landmark-popup">
            <h3>${landmark.name}</h3>
            <p>${landmark.description}</p>
          </div>
        `)
      )
      .addTo(this.map);

    this.state.markers.set(landmark.id, marker);

    setTimeout(() => {
      if (this.state.currentState !== UIState.INTERRUPTED) {
        marker.togglePopup();
      }
    }, 500);
  }

  clearAllMarkers(): void {
    this.state.markers.forEach((marker) => marker.remove());
    this.state.markers.clear();
    this.state.highlightedLandmarks.clear();
    this.state.currentLandmark = null;

    this.setCurrentLandmark(null);
  }

  setLandmarks(landmarks: LandmarkMap): void {
    this.landmarks = landmarks;
    this.clearAllMarkers();
  }

  get currentState(): OrchestrationState {
    return { ...this.state };
  }
}
