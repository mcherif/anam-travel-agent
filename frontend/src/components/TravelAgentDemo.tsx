import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createClient, AnamEvent } from '@anam-ai/js-sdk';
import mapboxgl from 'mapbox-gl';
import { motion, AnimatePresence } from 'framer-motion';
import 'mapbox-gl/dist/mapbox-gl.css';
import { UIOrchestrator, UIState } from './UIOrchestrator';
import { DebugHUD } from './DebugHUD';
import {
  buildLandmarksMap,
  CITY_IDS,
  DEFAULT_CITY,
  getCityCenter,
  getCityData,
  type CityId,
  type Landmark
} from '../data/landmarks';

type ToolCallEntry = {
  name: string;
  args: Record<string, unknown>;
  timestamp: number;
  status: 'pending' | 'executing' | 'complete';
};

type ImageItem = {
  url: string;
  source: 'local' | 'openverse';
  title?: string;
  author?: string;
  provider?: string;
  pageUrl?: string;
  license?: string;
  licenseUrl?: string;
};

type LandmarkMap = Record<string, Landmark>;

type DebugMetrics = {
  lastEvent: { type: string; timestamp: number; data: unknown } | null;
  toolCallQueue: ToolCallEntry[];
  latencies: {
    transcription?: number;
    llmResponse?: number;
    firstAudio?: number;
    firstToolCall?: number;
    highlightDelay?: number;
  };
  personaState: string;
  uiState: UIState;
  activeAnimations: number;
};

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;
const MAPILLARY_TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN as string | undefined;
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';
const MIC_TEST_MODE = import.meta.env.VITE_MIC_TEST === 'true';
const TOOL_FALLBACK_MODE = import.meta.env.VITE_TOOL_FALLBACK === 'true';
const LIVE_PHOTOS = import.meta.env.VITE_LIVE_PHOTOS === 'true';

if (MAPBOX_TOKEN) {
  mapboxgl.accessToken = MAPBOX_TOKEN;
} else {
  console.warn('Missing VITE_MAPBOX_TOKEN. Map will not load.');
}

if (mapboxgl.setRTLTextPlugin) {
  mapboxgl.setRTLTextPlugin(
    'https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.2.3/mapbox-gl-rtl-text.js',
    undefined,
    true
  );
}

const applyEnglishLabels = (map: mapboxgl.Map) => {
  const style = map.getStyle();
  if (!style || !style.layers) {
    return;
  }

  style.layers.forEach((layer) => {
    if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
      map.setLayoutProperty(layer.id, 'text-field', [
        'coalesce',
        ['get', 'name_en'],
        ['get', 'name:en'],
        ['get', 'name:latin']
      ]);
    }
  });
};

const clampZoom = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeText = (value: string) => value.trim().toLowerCase();

const slugifyText = (value: string) =>
  normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const getInitialCityId = (): CityId => {
  const envCity = import.meta.env.VITE_CITY as string | undefined;
  if (envCity && CITY_IDS.includes(envCity as CityId)) {
    return envCity as CityId;
  }

  return DEFAULT_CITY;
};

const resolveLandmarkId = (value: unknown, landmarks: LandmarkMap) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const key = normalizeText(value);
  if (landmarks[key]) {
    return key;
  }

  const slug = slugifyText(value);
  if (landmarks[slug]) {
    return slug;
  }

  const match = Object.values(landmarks).find((landmark) => {
    const name = normalizeText(landmark.name);
    return name === key || slugifyText(landmark.name) === slug;
  });

  return match?.id;
};

const normalizeToolArgs = (rawArgs: unknown, landmarks: LandmarkMap) => {
  let args: Record<string, unknown> = {};

  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch (error) {
      console.warn('Failed to parse tool args string:', error);
      return {};
    }
  } else if (rawArgs && typeof rawArgs === 'object') {
    args = rawArgs as Record<string, unknown>;
  }

  const nestedArgs = args.arguments ?? args.args ?? args.parameters ?? args.payload;
  if (nestedArgs && typeof nestedArgs === 'object') {
    args = nestedArgs as Record<string, unknown>;
  }

  const resolvedId = resolveLandmarkId(args.id, landmarks);
  if (resolvedId) {
    args = { ...args, id: resolvedId };
  }

  return args;
};

const findCityInText = (text: string, lookup: Array<{ id: CityId; name: string }>) => {
  const normalized = normalizeText(text);
  return lookup.find((city) => normalized.includes(city.name))?.id;
};

const MicTestView = () => {
  const [status, setStatus] = useState<'idle' | 'pending' | 'active' | 'denied' | 'error' | 'stopped'>('idle');
  const [level, setLevel] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('default');
  const [trackInfo, setTrackInfo] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    dataRef.current = null;
    setLevel(0);
    setTrackInfo(null);
    setStatus('stopped');
  };

  const refreshDevices = async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((device) => device.kind === 'audioinput'));
    } catch (error) {
      console.warn('Failed to enumerate devices:', error);
    }
  };

  const start = async () => {
    setMessage(null);
    setStatus('pending');

    try {
      const audioConstraints: MediaTrackConstraints = {
        autoGainControl: true,
        noiseSuppression: false,
        echoCancellation: false,
        channelCount: 1
      };

      if (selectedDeviceId && selectedDeviceId !== 'default') {
        audioConstraints.deviceId = { exact: selectedDeviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      await refreshDevices();

      const track = stream.getAudioTracks()[0];
      if (!track) {
        setStatus('error');
        setMessage('No audio track available from selected device.');
        return;
      }

      setTrackInfo(JSON.stringify(track.getSettings(), null, 2));

      const audioContext = new AudioContext();
      await audioContext.resume();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.fftSize);
      setStatus('active');

      const tick = () => {
        if (!analyserRef.current || !dataRef.current) {
          return;
        }

        analyserRef.current.getByteTimeDomainData(dataRef.current);
        let sum = 0;
        for (let i = 0; i < dataRef.current.length; i += 1) {
          const sample = (dataRef.current[i] - 128) / 128;
          sum += sample * sample;
        }

        const rms = Math.sqrt(sum / dataRef.current.length);
        setLevel(Math.min(1, rms * 8));
        rafRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch (error) {
      setStatus('denied');
      setMessage(error instanceof Error ? error.message : 'Microphone permission denied');
    }
  };

  useEffect(() => {
    refreshDevices();
    return () => stop();
  }, []);

  return (
    <div className="mic-test-container">
      <h2>Microphone Test</h2>
      <p className="mic-test-subtitle">This view skips Anam and map logic to validate audio capture.</p>
      <div className="mic-test-controls">
        <button className="manual-button" onClick={start} disabled={status === 'pending' || status === 'active'}>
          Start mic
        </button>
        <button className="manual-button" onClick={stop} disabled={status !== 'active'}>
          Stop mic
        </button>
        <button className="manual-button" onClick={refreshDevices}>
          Refresh devices
        </button>
        <span className={`manual-status manual-status-${status}`}>Mic: {status}</span>
      </div>
      <div className="mic-device-row">
        <label className="mic-device-label" htmlFor="mic-device-select">
          Input device
        </label>
        <select
          id="mic-device-select"
          className="mic-device-select"
          value={selectedDeviceId}
          onChange={(event) => setSelectedDeviceId(event.target.value)}
        >
          <option value="default">Default</option>
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Device ${device.deviceId.slice(0, 6)}`}
            </option>
          ))}
        </select>
      </div>
      <div className="mic-meter">
        <div className="mic-level" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <div className="mic-level-text">Level: {Math.round(level * 100)}%</div>
      {trackInfo && (
        <pre className="mic-track-info">{trackInfo}</pre>
      )}
      {message && <div className="manual-error">{message}</div>}
    </div>
  );
};

const TravelAgentDemo = () => {
  const initialCityId = getInitialCityId();
  const [selectedCity, setSelectedCity] = useState<CityId>(initialCityId);
  const cityData = getCityData(selectedCity);
  const landmarksById = useMemo(() => buildLandmarksMap(cityData.landmarks), [cityData]);
  const landmarkIds = useMemo(() => Object.keys(landmarksById), [landmarksById]);
  const primaryLandmark = cityData.landmarks[0];
  const cityOptions = useMemo(
    () => CITY_IDS.map((id) => ({ id, name: getCityData(id).city.name })),
    []
  );
  const supportedCitiesLabel = cityOptions.map((city) => city.name).join(', ');
  const cityLookup = useMemo(
    () =>
      CITY_IDS.map((id) => ({
        id,
        name: getCityData(id).city.name.toLowerCase()
      })),
    []
  );
  const cityConfig = useMemo(() => {
    const allLandmarksById: LandmarkMap = {};
    const landmarkCityMap: Record<string, CityId> = {};
    CITY_IDS.forEach((id) => {
      const data = getCityData(id);
      data.landmarks.forEach((landmark) => {
        allLandmarksById[landmark.id] = landmark;
        landmarkCityMap[landmark.id] = id;
      });
    });
    return {
      allLandmarksById,
      landmarkCityMap,
      allLandmarkIds: Object.keys(allLandmarksById)
    };
  }, []);

  const [anamClient, setAnamClient] = useState<ReturnType<typeof createClient> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [anamReady, setAnamReady] = useState(false);
  const [micStatus, setMicStatus] = useState<'unknown' | 'pending' | 'granted' | 'denied' | 'active'>('unknown');
  const [manualMessage, setManualMessage] = useState(
    `Tell me about ${getCityData(initialCityId).city.name}`
  );
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState('default');
  const [manualError, setManualError] = useState<string | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [debugZoom, setDebugZoom] = useState(18.5);
  const [applyDebugZoom, setApplyDebugZoom] = useState(true);
  const [streetViewUrl, setStreetViewUrl] = useState<string | null>(null);
  const [streetViewStatus, setStreetViewStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  >('idle');
  const [userVideoActive, setUserVideoActive] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'starting' | 'active' | 'error'>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraPanelCollapsed, setCameraPanelCollapsed] = useState(true);
  const [liveImages, setLiveImages] = useState<ImageItem[]>([]);
  const [livePhotoStatus, setLivePhotoStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [livePhotoError, setLivePhotoError] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const debugZoomRef = useRef(debugZoom);
  const applyDebugZoomRef = useRef(applyDebugZoom);
  const toolCallsSeenRef = useRef(false);
  const fallbackScheduledRef = useRef(false);
  const recentToolCallsRef = useRef<Array<{ key: string; timestamp: number }>>([]);

  const orchestratorRef = useRef<UIOrchestrator | null>(null);
  const landmarksRef = useRef<LandmarkMap>(landmarksById);
  const selectedCityRef = useRef<CityId>(selectedCity);
  const skipCityFlyRef = useRef(false);
  const [uiState, setUIState] = useState(UIState.IDLE);
  const [showInterrupted, setShowInterrupted] = useState(false);

  const [debugVisible, setDebugVisible] = useState(false);
  const [manualControlsVisible, setManualControlsVisible] = useState(true);
  const initialMetrics: DebugMetrics = {
    lastEvent: null,
    toolCallQueue: [],
    latencies: {},
    personaState: 'idle',
    uiState: UIState.IDLE,
    activeAnimations: 0
  };
  const [debugMetrics, setDebugMetrics] = useState<DebugMetrics>(initialMetrics);
  const debugMetricsRef = useRef<DebugMetrics>(initialMetrics);

  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const userVideoRef = useRef<HTMLVideoElement | null>(null);
  const userVideoStreamRef = useRef<MediaStream | null>(null);

  const [currentLandmark, setCurrentLandmark] = useState<Landmark | null>(null);
  const localImages = useMemo<ImageItem[]>(() => {
    if (!currentLandmark) {
      return [];
    }
    const urls =
      currentLandmark.imageUrls && currentLandmark.imageUrls.length > 0
        ? currentLandmark.imageUrls
        : [currentLandmark.imageUrl];
    return urls.map((url) => ({ url, source: 'local' }));
  }, [currentLandmark]);
  const combinedImages = useMemo<ImageItem[]>(() => {
    if (liveImages.length > 0) {
      return [...liveImages, ...localImages];
    }
    return localImages;
  }, [liveImages, localImages]);
  const activeLandmarkImage = combinedImages[activeImageIndex] ?? localImages[0];

  const updateDebugMetrics = (updates: Partial<DebugMetrics>) => {
    setDebugMetrics((prev) => {
      const next = {
        ...prev,
        ...updates,
        latencies: { ...prev.latencies, ...updates.latencies },
        toolCallQueue: updates.toolCallQueue ?? prev.toolCallQueue
      };
      debugMetricsRef.current = next;
      return next;
    });
  };

  useEffect(() => {
    debugZoomRef.current = debugZoom;
  }, [debugZoom]);

  useEffect(() => {
    applyDebugZoomRef.current = applyDebugZoom;
  }, [applyDebugZoom]);

  useEffect(() => {
    landmarksRef.current = landmarksById;
    orchestratorRef.current?.setLandmarks(landmarksById);
  }, [landmarksById]);

  useEffect(() => {
    selectedCityRef.current = selectedCity;
  }, [selectedCity]);

  useEffect(() => {
    const nextMessage = `Tell me about ${cityData.city.name}`;
    setManualMessage((prev) => {
      if (!prev || prev.toLowerCase().startsWith('tell me about')) {
        return nextMessage;
      }
      return prev;
    });
  }, [cityData.city.name]);

  useEffect(() => {
    toolCallsSeenRef.current = false;
    fallbackScheduledRef.current = false;
    recentToolCallsRef.current = [];
  }, [selectedCity]);

  const refreshVideoDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(list.filter((device) => device.kind === 'videoinput'));
    } catch (error) {
      console.warn('Failed to enumerate video devices:', error);
    }
  };

  useEffect(() => {
    if (!currentLandmark || combinedImages.length <= 1) {
      setActiveImageIndex(0);
      return;
    }

    setActiveImageIndex(0);
    const interval = window.setInterval(() => {
      setActiveImageIndex((prev) => (prev + 1) % combinedImages.length);
    }, 4000);

    return () => window.clearInterval(interval);
  }, [currentLandmark, combinedImages.length]);

  const stopUserVideoTracks = () => {
    if (userVideoStreamRef.current) {
      userVideoStreamRef.current.getTracks().forEach((track) => track.stop());
      userVideoStreamRef.current = null;
    }
  };

  const stopUserVideo = () => {
    stopUserVideoTracks();
    setUserVideoActive(false);
    setCameraStatus('idle');
    setCameraError(null);
    if (userVideoRef.current) {
      userVideoRef.current.srcObject = null;
    }
  };

  const startUserVideo = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error');
      setCameraError('Camera capture is not supported in this browser.');
      return false;
    }

    setCameraStatus('starting');
    setCameraError(null);
    stopUserVideoTracks();

    const hasSelectedDevice = selectedVideoDeviceId && selectedVideoDeviceId !== 'default';
    const constraints: MediaTrackConstraints | boolean = hasSelectedDevice
      ? { deviceId: { exact: selectedVideoDeviceId } }
      : true;

    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: constraints });
      userVideoStreamRef.current = videoStream;
      if (userVideoRef.current) {
        userVideoRef.current.srcObject = videoStream;
      }
      setUserVideoActive(true);
      setCameraStatus('active');
      await refreshVideoDevices();
      return true;
    } catch (error) {
      if (hasSelectedDevice) {
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
          userVideoStreamRef.current = fallbackStream;
          if (userVideoRef.current) {
            userVideoRef.current.srcObject = fallbackStream;
          }
          setUserVideoActive(true);
          setCameraStatus('active');
          await refreshVideoDevices();
          return true;
        } catch (fallbackError) {
          const message =
            fallbackError instanceof Error ? fallbackError.message : 'Camera access failed.';
          setCameraStatus('error');
          setCameraError(message);
          setUserVideoActive(false);
          return false;
        }
      }

      const message = error instanceof Error ? error.message : 'Camera access failed.';
      setCameraStatus('error');
      setCameraError(message);
      setUserVideoActive(false);
      return false;
    }
  };

  useEffect(() => {
    refreshVideoDevices();

    const handler = () => refreshVideoDevices();
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.addEventListener) {
      mediaDevices.addEventListener('devicechange', handler);
      return () => mediaDevices.removeEventListener('devicechange', handler);
    }

    return () => undefined;
  }, []);

  useEffect(() => {
    if (!userVideoActive || !userVideoStreamRef.current || !userVideoRef.current) {
      return;
    }

    userVideoRef.current.srcObject = userVideoStreamRef.current;
    const playPromise = userVideoRef.current.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => undefined);
    }
  }, [userVideoActive]);

  const switchCity = (nextCity: CityId, options?: { skipFly?: boolean }) => {
    if (nextCity === selectedCityRef.current) {
      return;
    }

    if (options?.skipFly) {
      skipCityFlyRef.current = true;
    }

    const nextLandmarks = buildLandmarksMap(getCityData(nextCity).landmarks);
    landmarksRef.current = nextLandmarks;
    orchestratorRef.current?.setLandmarks(nextLandmarks);
    setSelectedCity(nextCity);
  };

  useEffect(() => {
    if (map.current || !mapContainer.current) {
      return;
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: cityData.city.coordinates,
      zoom: cityData.city.zoom,
      pitch: 60,
      bearing: -10
    });

    map.current.addControl(new mapboxgl.NavigationControl());

    map.current.on('load', () => {
      if (map.current) {
        if (!map.current.getSource('mapbox-dem')) {
          map.current.addSource('mapbox-dem', {
            type: 'raster-dem',
            url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
            tileSize: 512,
            maxzoom: 14
          });
          map.current.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 });
        }

        if (!map.current.getLayer('sky')) {
          map.current.addLayer({
            id: 'sky',
            type: 'sky',
            paint: {
              'sky-type': 'atmosphere',
              'sky-atmosphere-sun': [0.0, 0.0],
              'sky-atmosphere-sun-intensity': 10
            }
          });
        }

        map.current.setFog({
          range: [0.8, 8],
          color: '#eef2ff',
          'high-color': '#f8fafc',
          'space-color': '#dbeafe',
          'horizon-blend': 0.2,
          'star-intensity': 0.1
        });

        map.current.setLight({
          anchor: 'viewport',
          color: '#ffffff',
          intensity: 0.6,
          position: [1.15, 210, 30]
        });

        applyEnglishLabels(map.current);
        map.current.on('styledata', () => applyEnglishLabels(map.current as mapboxgl.Map));
      }

      setMapReady(true);
    });

    orchestratorRef.current = new UIOrchestrator(
      map.current,
      landmarksById,
      setCurrentLandmark,
      setUIState,
      setShowInterrupted,
      updateDebugMetrics
    );
  }, []);

  useEffect(() => {
    orchestratorRef.current?.setReady(mapReady && anamReady);
  }, [mapReady, anamReady]);

  useEffect(() => {
    if (!currentLandmark) {
      setStreetViewUrl(null);
      setStreetViewStatus('idle');
      return;
    }

    if (!MAPILLARY_TOKEN) {
      setStreetViewUrl(null);
      setStreetViewStatus('unavailable');
      return;
    }

    const controller = new AbortController();
    let isActive = true;

    const fetchStreetView = async () => {
      setStreetViewStatus('loading');
      const [lng, lat] = currentLandmark.coordinates;
      const endpoint = new URL('https://graph.mapillary.com/images');
      endpoint.searchParams.set('access_token', MAPILLARY_TOKEN);
      endpoint.searchParams.set('fields', 'id,thumb_1024_url');
      endpoint.searchParams.set('closeto', `${lng},${lat}`);
      endpoint.searchParams.set('limit', '1');

      try {
        const response = await fetch(endpoint.toString(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Mapillary error ${response.status}`);
        }
        const data = (await response.json()) as {
          data?: Array<{ id?: string; thumb_1024_url?: string }>;
        };
        const image = data?.data?.[0];
        if (!isActive) {
          return;
        }
        if (image?.thumb_1024_url) {
          setStreetViewUrl(image.thumb_1024_url);
          setStreetViewStatus('ready');
        } else {
          setStreetViewUrl(null);
          setStreetViewStatus('unavailable');
        }
      } catch (error) {
        if (!isActive) {
          return;
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.warn('Failed to load Mapillary street image:', error);
        setStreetViewUrl(null);
        setStreetViewStatus('error');
      }
    };

    fetchStreetView();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [currentLandmark, MAPILLARY_TOKEN]);

  useEffect(() => {
    if (!currentLandmark || !LIVE_PHOTOS) {
      setLiveImages([]);
      setLivePhotoStatus('idle');
      setLivePhotoError(null);
      return;
    }

    if (!BACKEND_URL) {
      setLiveImages([]);
      setLivePhotoStatus('error');
      setLivePhotoError('Missing VITE_BACKEND_URL');
      return;
    }

    const controller = new AbortController();
    let isActive = true;
    const cityName = getCityData(selectedCityRef.current).city.name;
    const query = `${currentLandmark.name} ${cityName}`;

    const fetchLivePhotos = async () => {
      setLivePhotoStatus('loading');
      setLivePhotoError(null);

      try {
        const response = await fetch(
          `${BACKEND_URL}/api/photos?q=${encodeURIComponent(query)}&perPage=6`,
          { signal: controller.signal }
        );
        const data = (await response.json()) as {
          photos?: Array<{
            imageUrl?: string;
            title?: string;
            ownerName?: string;
            pageUrl?: string;
            license?: string;
            licenseUrl?: string;
            provider?: string;
          }>;
        };
        if (!isActive) {
          return;
        }
        if (!response.ok) {
          throw new Error(data ? JSON.stringify(data) : 'Failed to load photos');
        }

        const photos =
          data.photos
            ?.filter((photo) => typeof photo.imageUrl === 'string')
            .map((photo) => ({
              url: photo.imageUrl as string,
              source: 'openverse' as const,
              title: photo.title,
              author: photo.ownerName,
              provider: photo.provider,
              pageUrl: photo.pageUrl,
              license: photo.license,
              licenseUrl: photo.licenseUrl
            })) || [];

        setLiveImages(photos);
        setLivePhotoStatus(photos.length > 0 ? 'ready' : 'idle');
      } catch (error) {
        if (!isActive) {
          return;
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.warn('Failed to load live photos:', error);
        setLiveImages([]);
        setLivePhotoStatus('error');
        setLivePhotoError(error instanceof Error ? error.message : 'Failed to load photos');
      }
    };

    fetchLivePhotos();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [currentLandmark, selectedCity, BACKEND_URL, LIVE_PHOTOS]);

  useEffect(() => {
    if (!map.current || !mapReady) {
      return;
    }

    if (skipCityFlyRef.current) {
      skipCityFlyRef.current = false;
      return;
    }

    const center = getCityCenter(selectedCity);
    orchestratorRef.current?.clearAllMarkers();
    map.current.flyTo({
      center: center.coordinates,
      zoom: center.zoom,
      duration: 1200,
      essential: true,
      pitch: 60,
      bearing: -10
    });
  }, [mapReady, selectedCity]);

  useEffect(() => {
    if (MIC_TEST_MODE || anamClient) {
      return;
    }
    const initAnam = async () => {
      try {
        if (!BACKEND_URL) {
          throw new Error('Missing VITE_BACKEND_URL');
        }

        const cityName = cityData.city.name;
        const primaryLandmarkId = primaryLandmark?.id ?? landmarkIds[0] ?? 'medina';
        const primaryLandmarkName = primaryLandmark?.name ?? 'the city center';
        const citySummaries = CITY_IDS.map((id) => {
          const data = getCityData(id);
          const starter = data.landmarks[0];
          return `- ${data.city.name}: start with ${starter?.name ?? 'the city center'} (id: ${starter?.id ?? 'center'})`;
        }).join('\n');

        const tools = [
          {
            type: 'client',
            name: 'set_city',
            description: 'Switch the active city before discussing its landmarks.',
            parameters: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'City identifier',
                  enum: CITY_IDS
                }
              },
              required: ['id']
            }
          },
          {
            type: 'client',
            name: 'fly_to_landmark',
            description:
              'Animate the map camera to a specific landmark. Call this RIGHT BEFORE mentioning the landmark for the first time.',
            parameters: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Landmark identifier',
                  enum: cityConfig.allLandmarkIds
                },
                zoom: {
                  type: 'number',
                  description: 'Zoom level (17-19)',
                  default: 18
                }
              },
              required: ['id']
            }
          },
          {
            type: 'client',
            name: 'show_landmark_panel',
            description: 'Display detailed information panel for a landmark. Call immediately after fly_to_landmark.',
            parameters: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Landmark identifier (must match fly_to_landmark id)',
                  enum: cityConfig.allLandmarkIds
                }
              },
              required: ['id']
            }
          },
          {
            type: 'client',
            name: 'dim_previous_landmarks',
            description:
              'Fade previous landmark markers to maintain focus on the current one. Call before introducing a new landmark.',
            parameters: {
              type: 'object',
              properties: {}
            }
          }
        ];

        const systemPrompt = `You are Sofia, an enthusiastic travel agent for these cities: ${CITY_IDS.map(
          (id) => getCityData(id).city.name
        ).join(', ')}.
When the user requests a different city, call set_city({ id }) before discussing its landmarks.
You MUST call at least one tool in every response that mentions a place. If the user asks about ${cityName}, start with ${primaryLandmarkName}. Use zoom 18-19 unless the tool call specifies otherwise.

## Available Tools
You have these tools to control the map visualization:

0. **set_city({ id })** - Switch the active city (call before discussing a different city)

1. **fly_to_landmark({ id, zoom })** - Animate map to a landmark
   - Call this RIGHT BEFORE you mention a landmark for the first time
   - Example: "Let me show you the Medina..." [CALL fly_to_landmark({ id: "medina" })]

2. **show_landmark_panel({ id })** - Display detailed information panel
   - Call immediately AFTER fly_to_landmark
   - Shows photos, history, and highlights

3. **dim_previous_landmarks()** - Fade previous markers to maintain focus
   - Call before introducing a NEW landmark (not the first one)

## Conversation Flow
For each landmark you discuss:
1. Call fly_to_landmark({ id: "landmark-id", zoom: 18 })
2. Describe the landmark (2-3 sentences while map animates)
3. Call show_landmark_panel({ id: "landmark-id" })
4. Mention key highlights
5. Before moving to next landmark, call dim_previous_landmarks()

## City Starters
${citySummaries}

## Speaking Style
- Warm and enthusiastic but not overwhelming
- Keep responses to 2-4 sentences per landmark
- Natural pauses for visual absorption
- Ask if they want to explore deeper or see another location

## Example Interaction
User: "Tell me about ${cityName}"
You: [CALL fly_to_landmark({ id: "${primaryLandmarkId}", zoom: 16 })]
You: "I'd love to! Let me start with ${primaryLandmarkName}. It is one of the best places to begin a tour of ${cityName}."
You: [CALL show_landmark_panel({ id: "${primaryLandmarkId}" })]
You: "Would you like to explore another landmark, or go deeper here?"`;

        const personaConfig = {
          name: 'Sofia',
          avatarId: '30fa96d0-26c4-4e55-94a0-517025942e18',
          voiceId: '6bfbe25a-979d-40f3-a92b-5394170af54b',
          llmId: '0934d97d-0c3a-4f33-91b0-5e136a0ef466',
          systemPrompt,
          tools
        };

        const tokenResponse = await fetch(`${BACKEND_URL}/api/session-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientLabel: 'anam-travel-agent',
            personaConfig
          })
        });

        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok) {
          throw new Error(tokenData.error || 'Failed to get session token');
        }

        const { sessionToken } = tokenData;
        if (!sessionToken) {
          throw new Error('Missing sessionToken in response');
        }
        const client = createClient(sessionToken);

        setupAnamListeners(client);
        setAnamClient(client);
      } catch (error) {
        console.error('Failed to initialize Anam:', error);
        const message = error instanceof Error ? error.message : String(error);
        setStartupError(message);
        updateDebugMetrics({
          lastEvent: {
            type: 'ERROR',
            timestamp: Date.now(),
            data: { message }
          }
        });
      }
    };

    initAnam();
  }, [anamClient, landmarkIds, selectedCity]);

  useEffect(() => () => stopUserVideo(), []);

  const setupAnamListeners = (client: ReturnType<typeof createClient>) => {
    client.addListener(AnamEvent.CONNECTION_ESTABLISHED, () => {
      setIsConnected(true);
      setAnamReady(true);
      updateDebugMetrics({
        lastEvent: {
          type: 'CONNECTION_ESTABLISHED',
          timestamp: Date.now(),
          data: {}
        },
        personaState: 'idle'
      });
    });

    client.addListener(AnamEvent.VIDEO_PLAY_STARTED, () => {
      setAnamReady(true);
      updateDebugMetrics({
        lastEvent: {
          type: 'VIDEO_PLAY_STARTED',
          timestamp: Date.now(),
          data: {}
        }
      });
    });

    client.addListener(AnamEvent.SESSION_READY, () => {
      setAnamReady(true);
      updateDebugMetrics({
        lastEvent: {
          type: 'SESSION_READY',
          timestamp: Date.now(),
          data: {}
        }
      });
    });

    client.addListener(AnamEvent.SERVER_WARNING, (message) => {
      updateDebugMetrics({
        lastEvent: {
          type: 'SERVER_WARNING',
          timestamp: Date.now(),
          data: { message }
        }
      });
    });

    client.addListener(AnamEvent.CONNECTION_CLOSED, (reason, details) => {
      setIsConnected(false);
      updateDebugMetrics({
        lastEvent: {
          type: 'CONNECTION_CLOSED',
          timestamp: Date.now(),
          data: { reason, details }
        }
      });
    });

    const handleToolEvent = async (event: unknown) => {
      const toolCallStart = Date.now();
      const payload = event && typeof event === 'object' ? (event as Record<string, unknown>) : {};
      const toolName =
        (typeof payload.eventName === 'string' && payload.eventName) ||
        (typeof payload.event_name === 'string' && payload.event_name) ||
        (typeof payload.toolName === 'string' && payload.toolName) ||
        (typeof payload.name === 'string' && payload.name);
      const toolArgs = payload.eventData ?? payload.event_data ?? payload.arguments ?? payload.args;

      if (!toolName) {
        updateDebugMetrics({
          lastEvent: {
            type: 'TOOL_CALL_MISSING_NAME',
            timestamp: toolCallStart,
            data: event
          }
        });
        return;
      }

      toolCallsSeenRef.current = true;
      let normalizedArgs = normalizeToolArgs(toolArgs, landmarksRef.current);
      if (!DEMO_MODE && applyDebugZoomRef.current) {
        normalizedArgs = {
          ...normalizedArgs,
          zoom: clampZoom(debugZoomRef.current, 16, 20)
        };
      }

      if (toolName === 'set_city') {
        const nextCity = typeof normalizedArgs.id === 'string' ? normalizedArgs.id.toLowerCase() : '';
        if (CITY_IDS.includes(nextCity as CityId)) {
          switchCity(nextCity as CityId);
        }

        const existingQueue = debugMetricsRef.current.toolCallQueue;
        updateDebugMetrics({
          lastEvent: {
            type: 'TOOL_CALL',
            timestamp: toolCallStart,
            data: event
          },
          toolCallQueue: [
            ...existingQueue,
            {
              name: toolName,
              args: normalizedArgs,
              timestamp: toolCallStart,
              status: 'complete'
            }
          ]
        });
        return;
      }

      if (
        (toolName === 'fly_to_landmark' || toolName === 'show_landmark_panel') &&
        typeof normalizedArgs.id === 'string'
      ) {
        const targetCity = cityConfig.landmarkCityMap[normalizedArgs.id];
        if (targetCity && targetCity !== selectedCityRef.current) {
          switchCity(targetCity, { skipFly: true });
        }
      }

      const key = `${toolName}:${JSON.stringify(normalizedArgs)}`;
      const now = Date.now();
      recentToolCallsRef.current = recentToolCallsRef.current.filter((entry) => now - entry.timestamp < 500);
      if (recentToolCallsRef.current.some((entry) => entry.key === key)) {
        return;
      }
      recentToolCallsRef.current.push({ key, timestamp: now });

      const existingQueue = debugMetricsRef.current.toolCallQueue;

      updateDebugMetrics({
        lastEvent: {
          type: 'TOOL_CALL',
          timestamp: toolCallStart,
          data: event
        },
        toolCallQueue: [
          ...existingQueue,
          {
            name: toolName,
            args: normalizedArgs,
            timestamp: toolCallStart,
            status: 'executing'
          }
        ]
      });

      await orchestratorRef.current?.handleToolCall(toolName, normalizedArgs);

      const highlightDelay = Date.now() - toolCallStart;
      const updatedQueue = debugMetricsRef.current.toolCallQueue.map((call) =>
        call.timestamp === toolCallStart ? { ...call, status: 'complete' } : call
      );

      updateDebugMetrics({
        latencies: {
          firstToolCall: toolCallStart,
          highlightDelay
        },
        toolCallQueue: updatedQueue
      });
    };

    client.addListener(AnamEvent.CLIENT_TOOL_EVENT_RECEIVED, handleToolEvent);
    const legacyToolEvent = (AnamEvent as Record<string, string>).TOOL_CALL;
    if (legacyToolEvent && legacyToolEvent !== AnamEvent.CLIENT_TOOL_EVENT_RECEIVED) {
      client.addListener(legacyToolEvent as AnamEvent, handleToolEvent);
    }

    client.addListener(AnamEvent.TALK_STREAM_INTERRUPTED, (event) => {
      orchestratorRef.current?.handleInterrupt();
      updateDebugMetrics({
        lastEvent: {
          type: 'INTERRUPTED',
          timestamp: Date.now(),
          data: event
        },
        personaState: 'interrupted'
      });
    });

    client.addListener(AnamEvent.MESSAGE_STREAM_EVENT_RECEIVED, (event) => {
      const role = (event as { type?: string; role?: string }).type || (event as { role?: string }).role;
      if (role === 'persona') {
        updateDebugMetrics({
          personaState: 'speaking',
          lastEvent: {
            type: 'PERSONA_SPEAKING',
            timestamp: Date.now(),
            data: { text: event.text }
          }
        });

        if (!DEMO_MODE && TOOL_FALLBACK_MODE && !toolCallsSeenRef.current && !fallbackScheduledRef.current) {
          fallbackScheduledRef.current = true;
          scheduleFallbackTools();
        }
      } else if (role === 'user') {
        const text = typeof event.text === 'string' ? event.text : '';
        const requestedCity = text ? findCityInText(text, cityLookup) : undefined;
        if (requestedCity) {
          switchCity(requestedCity);
        }

        if (debugMetricsRef.current.personaState === 'speaking') {
          orchestratorRef.current?.handleInterrupt();
        }

        updateDebugMetrics({
          personaState: 'listening',
          lastEvent: {
            type: 'USER_SPEAKING',
            timestamp: Date.now(),
            data: { text: event.text }
          }
        });
      }
    });

    client.addListener(AnamEvent.MIC_PERMISSION_GRANTED, () => {
      setMicStatus('granted');
      updateDebugMetrics({
        lastEvent: {
          type: 'MIC_PERMISSION_GRANTED',
          timestamp: Date.now(),
          data: {}
        }
      });
    });

    client.addListener(AnamEvent.MIC_PERMISSION_DENIED, () => {
      setMicStatus('denied');
      updateDebugMetrics({
        lastEvent: {
          type: 'MIC_PERMISSION_DENIED',
          timestamp: Date.now(),
          data: {}
        }
      });
    });

    client.addListener(AnamEvent.INPUT_AUDIO_STREAM_STARTED, () => {
      setMicStatus('active');
      updateDebugMetrics({
        lastEvent: {
          type: 'INPUT_AUDIO_STREAM_STARTED',
          timestamp: Date.now(),
          data: {}
        }
      });
    });

    client.addListener(AnamEvent.MESSAGE_HISTORY_UPDATED, (messages) => {
      updateDebugMetrics({
        personaState: 'idle',
        lastEvent: {
          type: 'MESSAGE_COMPLETE',
          timestamp: Date.now(),
          data: { messageCount: messages.length }
        }
      });
    });
  };

  const startConversation = async () => {
    if (!anamClient) {
      setStartupError('Anam client is not initialized. Check backend and session token.');
      return;
    }

    try {
      setMicStatus('pending');
      let userAudioStream: MediaStream | undefined;
      try {
        userAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error) {
        console.warn('Microphone access failed, continuing without input audio.', error);
        setMicStatus('denied');
      }

      await startUserVideo();

      await anamClient.streamToVideoElement('anam-video', userAudioStream);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStartupError(message);
      console.error('Failed to start conversation:', error);
    }
  };

  const scheduleFallbackTools = () => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) {
      return;
    }

    const fallbackLandmarks = cityData.landmarks.slice(0, 4);
    const steps: Array<{ delay: number; tool: string; args: Record<string, unknown> }> = [];
    let delay = 0;

    fallbackLandmarks.forEach((landmark, index) => {
      if (index > 0) {
        steps.push({ delay, tool: 'dim_previous_landmarks', args: {} });
        delay += 500;
      }

      steps.push({
        delay,
        tool: 'fly_to_landmark',
        args: { id: landmark.id, zoom: landmark.zoom }
      });
      steps.push({
        delay: delay + 800,
        tool: 'show_landmark_panel',
        args: { id: landmark.id }
      });
      delay += 6500;
    });

    steps.forEach((step) => {
      setTimeout(() => {
        if (!toolCallsSeenRef.current) {
          orchestrator.handleToolCall(step.tool, step.args);
        }
      }, step.delay);
    });
  };

  const sendManualMessage = async () => {
    if (!anamClient) {
      return;
    }

    setManualError(null);
    try {
      await anamClient.sendUserMessage(manualMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      setManualError(message);
    }
  };

  const runToolTest = async () => {
    setManualError(null);

    if (!orchestratorRef.current) {
      setManualError('UI orchestrator is not ready yet.');
      return;
    }

    if (!mapReady) {
      setManualError('Map is not ready yet.');
      return;
    }

    if (!primaryLandmark) {
      setManualError('No landmarks available for the selected city.');
      return;
    }

    const testStart = Date.now();
    const testArgs = {
      id: primaryLandmark.id,
      zoom: clampZoom(debugZoomRef.current, 16, 20)
    };
    const existingQueue = debugMetricsRef.current.toolCallQueue;

    updateDebugMetrics({
      lastEvent: {
        type: 'TOOL_TEST',
        timestamp: testStart,
        data: testArgs
      },
      toolCallQueue: [
        ...existingQueue,
        {
          name: 'fly_to_landmark',
          args: testArgs,
          timestamp: testStart,
          status: 'executing'
        }
      ]
    });

    await orchestratorRef.current.handleToolCall('fly_to_landmark', testArgs);
    await orchestratorRef.current.handleToolCall('show_landmark_panel', { id: primaryLandmark.id });

    const updatedQueue = debugMetricsRef.current.toolCallQueue.map((call) =>
      call.timestamp === testStart ? { ...call, status: 'complete' } : call
    );
    updateDebugMetrics({ toolCallQueue: updatedQueue });
  };

  const handleResume = () => {
    orchestratorRef.current?.handleResume();
    setShowInterrupted(false);
    updateDebugMetrics({ personaState: 'speaking' });
  };

  const handleRestartCamera = async () => {
    await startUserVideo();
  };

  useEffect(() => {
    if (DEMO_MODE) {
      return;
    }

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key === 'D') {
        setDebugVisible((prev) => !prev);
      }
      if (event.ctrlKey && event.shiftKey && event.key === 'M') {
        setManualControlsVisible((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  if (MIC_TEST_MODE) {
    return <MicTestView />;
  }

  return (
    <div className="travel-agent-container">
      <div className="persona-container">
        <video id="anam-video" autoPlay playsInline className="persona-video" />

        {userVideoActive && (
          <div className="user-video-preview">
            <video ref={userVideoRef} autoPlay playsInline muted className="user-video-element" />
            <span className="user-video-label">You</span>
          </div>
        )}

        {isConnected && (
          <div className={`camera-panel ${cameraPanelCollapsed ? 'camera-panel-collapsed' : ''}`}>
            <div className="camera-panel-header">
              <span className="camera-panel-title">Camera</span>
              <button
                className="camera-toggle"
                onClick={() => setCameraPanelCollapsed((prev) => !prev)}
                aria-label={cameraPanelCollapsed ? 'Expand camera panel' : 'Collapse camera panel'}
              >
                {cameraPanelCollapsed ? '+' : '–'}
              </button>
            </div>
            {!cameraPanelCollapsed && (
              <>
                <label className="city-picker-label" htmlFor="camera-picker-overlay">
                  Device
                </label>
                <select
                  id="camera-picker-overlay"
                  className="city-picker-select"
                  value={selectedVideoDeviceId}
                  onChange={(event) => setSelectedVideoDeviceId(event.target.value)}
                >
                  <option value="default">Default camera</option>
                  {videoDevices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${device.deviceId.slice(0, 6)}`}
                    </option>
                  ))}
                </select>
                <div className="camera-panel-actions">
                  <button
                    className="camera-button"
                    onClick={handleRestartCamera}
                    disabled={cameraStatus === 'starting'}
                  >
                    {cameraStatus === 'starting' ? 'Starting...' : 'Restart camera'}
                  </button>
                  <button className="camera-button camera-button-secondary" onClick={refreshVideoDevices}>
                    Refresh
                  </button>
                </div>
                {cameraError && <div className="camera-error">{cameraError}</div>}
              </>
            )}
            <div className={`camera-status camera-status-${cameraStatus}`}>Camera: {cameraStatus}</div>
          </div>
        )}

        {!isConnected && (
          <div className="start-panel">
            <div className="city-picker">
            <label className="city-picker-label" htmlFor="city-picker-start">
              Choose a city
            </label>
            <select
              id="city-picker-start"
              className="city-picker-select"
              value={selectedCity}
              onChange={(event) => switchCity(event.target.value as CityId)}
            >
              {cityOptions.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
            <label className="city-picker-label" htmlFor="camera-picker-start">
              Camera
            </label>
            <select
              id="camera-picker-start"
              className="city-picker-select"
              value={selectedVideoDeviceId}
              onChange={(event) => setSelectedVideoDeviceId(event.target.value)}
            >
              <option value="default">Default camera</option>
              {videoDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
            <div className="city-picker-supported">Supported: {supportedCitiesLabel}</div>
            <div className="city-picker-hint">Or say: "Switch to Istanbul"</div>
          </div>
          <button onClick={startConversation} className="start-button">
            Start Your Journey
          </button>
          {startupError && <div className="manual-error">{startupError}</div>}
        </div>
      )}

        {debugMetrics.personaState === 'speaking' && !showInterrupted && (
          <div className="speaking-indicator">
            <div className="pulse-ring"></div>
            Sofia is speaking...
          </div>
        )}
      </div>

      <div className="map-container">
        <div ref={mapContainer} className="map" />
        <div className="city-overlay">
          <label className="city-picker-label" htmlFor="city-picker-overlay">
            City
          </label>
          <select
            id="city-picker-overlay"
            className="city-picker-select"
            value={selectedCity}
            onChange={(event) => switchCity(event.target.value as CityId)}
          >
            {cityOptions.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
          <div className="city-picker-supported">Supported: {supportedCitiesLabel}</div>
          <div className="city-picker-hint">Say: "Switch to Istanbul"</div>
        </div>

        <AnimatePresence>
          {currentLandmark && (
            <motion.div
              className="landmark-info-panel"
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <AnimatePresence mode="wait">
                <motion.img
                  key={activeLandmarkImage?.url || currentLandmark.imageUrl}
                  src={activeLandmarkImage?.url || currentLandmark.imageUrl}
                  alt={currentLandmark.name}
                  className="landmark-image"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                />
              </AnimatePresence>
              {LIVE_PHOTOS && livePhotoStatus === 'loading' && (
                <div className="landmark-photo-status">Loading live photos...</div>
              )}
              {activeLandmarkImage?.source === 'openverse' && activeLandmarkImage.pageUrl && (
                <div className="landmark-photo-credit">
                  Photo:{' '}
                  <a href={activeLandmarkImage.pageUrl} target="_blank" rel="noreferrer">
                    {activeLandmarkImage.title || 'Openverse'}
                  </a>
                  {activeLandmarkImage.author && ` by ${activeLandmarkImage.author}`}
                  {activeLandmarkImage.provider && ` · ${activeLandmarkImage.provider}`}
                  {activeLandmarkImage.license &&
                    ` (${activeLandmarkImage.license})`}
                </div>
              )}
              <h2>{currentLandmark.name}</h2>
              <p className="landmark-type">{currentLandmark.type}</p>
              <p className="landmark-description">{currentLandmark.description}</p>

              <div className="landmark-highlights">
                <h3>Highlights</h3>
                <ul>
                  {currentLandmark.highlights.map((highlight, index) => (
                    <motion.li
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.2 }}
                    >
                      {highlight}
                    </motion.li>
                  ))}
                </ul>
              </div>

              {currentLandmark.foundedYear && (
                <div className="landmark-founded">
                  <strong>Founded:</strong> {currentLandmark.foundedYear}
                </div>
              )}

              {(streetViewStatus === 'ready' || streetViewStatus === 'loading') && (
                <div className="street-view-panel">
                  <h3>Street View</h3>
                  {streetViewStatus === 'ready' && streetViewUrl && (
                    <img
                      src={streetViewUrl}
                      alt={`Street view near ${currentLandmark.name}`}
                      className="street-view-image"
                    />
                  )}
                  {streetViewStatus === 'loading' && (
                    <p className="street-view-status">Loading street imagery...</p>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showInterrupted && (
          <motion.div
            className="interrupted-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="interrupted-card">
              <div className="icon">!</div>
              <h3>Paused</h3>
              <p>Sofia was interrupted</p>
              <button onClick={handleResume} className="resume-button">
                Resume Tour
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DebugHUD
        metrics={{
          ...debugMetrics,
          uiState,
          activeAnimations: orchestratorRef.current?.state.activeAnimations.length || 0
        }}
        visible={!DEMO_MODE && debugVisible}
      />

      {!DEMO_MODE && (
        <div className="debug-hint">
          Press <kbd>Ctrl+Shift+D</kbd> for Debug HUD · <kbd>Ctrl+Shift+M</kbd> to toggle controls
        </div>
      )}

      {!DEMO_MODE && manualControlsVisible && (
        <div className="manual-controls">
          <div className="manual-row">
            <span className={`manual-status manual-status-${micStatus}`}>
              Mic: {micStatus}
            </span>
          </div>
          <div className="manual-row">
            <label className="manual-label" htmlFor="city-select">
              City
            </label>
            <select
              id="city-select"
              className="manual-input"
              value={selectedCity}
              onChange={(event) => switchCity(event.target.value as CityId)}
            >
              {cityOptions.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </div>
          <div className="manual-row">
            <input
              className="manual-input"
              value={manualMessage}
              onChange={(event) => setManualMessage(event.target.value)}
            />
            <button className="manual-button" onClick={sendManualMessage}>
              Send Text
            </button>
          </div>
          <div className="manual-row manual-row-stack">
            <label className="manual-label" htmlFor="debug-zoom">
              Debug zoom: {debugZoom.toFixed(1)}
            </label>
            <input
              id="debug-zoom"
              className="manual-range"
              type="range"
              min="16"
              max="20"
              step="0.1"
              value={debugZoom}
              onChange={(event) => setDebugZoom(Number(event.target.value))}
            />
          </div>
          <label className="manual-checkbox">
            <input
              type="checkbox"
              checked={applyDebugZoom}
              onChange={(event) => setApplyDebugZoom(event.target.checked)}
            />
            Override tool zoom
          </label>
          <div className="manual-row">
            <button className="manual-button" onClick={runToolTest}>
              Test Tool Call
            </button>
          </div>
          {manualError && <div className="manual-error">{manualError}</div>}
          {livePhotoStatus === 'error' && livePhotoError && (
            <div className="manual-error">Live photos: {livePhotoError}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default TravelAgentDemo;
