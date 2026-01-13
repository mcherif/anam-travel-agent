const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

const defaultOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedOrigins = (process.env.CORS_ORIGINS || defaultOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const isOriginAllowed = (origin) => allowedOrigins.includes('*') || allowedOrigins.includes(origin);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    }
  })
);
app.use(express.json());

const getFetch = () => {
  if (typeof fetch === 'function') {
    return fetch;
  }
  return (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));
};

const OPENVERSE_API_URL = process.env.OPENVERSE_API_URL || 'https://api.openverse.org/v1/images';
const OPENVERSE_LICENSE_TYPE = process.env.OPENVERSE_LICENSE_TYPE || 'all';
const PEXELS_API_URL = process.env.PEXELS_API_URL || 'https://api.pexels.com/v1/search';
const PHOTO_PROVIDER = (process.env.PHOTO_PROVIDER || 'openverse').toLowerCase();
const PEXELS_LICENSE = {
  name: 'Pexels License',
  url: 'https://www.pexels.com/license/'
};
const PHOTO_CACHE_TTL_MS = 1000 * 60 * 10;
const photoCache = new Map();

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/session-token', async (req, res) => {
  try {
    const apiKey = process.env.ANAM_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'Missing ANAM_API_KEY' });
      return;
    }

    const { personaConfig, clientLabel } = req.body || {};
    const payload = {
      clientLabel: clientLabel || 'anam-travel-agent'
    };
    if (personaConfig) {
      payload.personaConfig = personaConfig;
    }

    const response = await getFetch()('https://api.anam.ai/v1/auth/session-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get session token' });
  }
});

app.get('/api/photos', async (req, res) => {
  try {
    const query =
      (typeof req.query.q === 'string' && req.query.q.trim()) ||
      (typeof req.query.query === 'string' && req.query.query.trim()) ||
      '';
    if (!query) {
      res.status(400).json({ error: 'Missing query parameter' });
      return;
    }

    const perPageRaw = Number(req.query.perPage || req.query.per_page || 8);
    const perPage = Number.isFinite(perPageRaw) ? Math.min(Math.max(perPageRaw, 1), 12) : 8;
    const providerParam = typeof req.query.provider === 'string' ? req.query.provider.toLowerCase() : '';
    const provider = providerParam || PHOTO_PROVIDER;
    const cacheKey = `${provider}|${query.toLowerCase()}|${perPage}`;
    const cached = photoCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PHOTO_CACHE_TTL_MS) {
      res.json(cached.payload);
      return;
    }

    const fetchOpenverse = async () => {
      const params = new URLSearchParams({
        q: query,
        page_size: String(perPage),
        license_type: OPENVERSE_LICENSE_TYPE
      });

      const response = await getFetch()(`${OPENVERSE_API_URL}?${params.toString()}`, {
        headers: { 'User-Agent': 'anam-travel-agent/1.0' }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error('Failed to fetch Openverse photos');
      }

      const results = Array.isArray(data.results) ? data.results : [];
      return results
        .map((photo) => {
          const imageUrl = photo.url || photo.thumbnail;
          if (!imageUrl) {
            return null;
          }
          const licenseLabel = photo.license
            ? `${String(photo.license).toUpperCase()}${photo.license_version ? ` ${photo.license_version}` : ''}`
            : '';
          return {
            id: photo.id,
            title: photo.title,
            ownerName: photo.creator || '',
            pageUrl: photo.foreign_landing_url || photo.url || '',
            imageUrl,
            license: licenseLabel,
            licenseUrl: photo.license_url || '',
            provider: photo.provider || 'Openverse'
          };
        })
        .filter(Boolean);
    };

    const fetchPexels = async () => {
      const apiKey = process.env.PEXELS_API_KEY;
      if (!apiKey) {
        throw new Error('Missing PEXELS_API_KEY');
      }
      const params = new URLSearchParams({
        query,
        per_page: String(perPage)
      });
      const response = await getFetch()(`${PEXELS_API_URL}?${params.toString()}`, {
        headers: { Authorization: apiKey, 'User-Agent': 'anam-travel-agent/1.0' }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error('Failed to fetch Pexels photos');
      }
      const results = Array.isArray(data.photos) ? data.photos : [];
      return results
        .map((photo) => {
          const imageUrl = photo.src?.large || photo.src?.medium || photo.src?.original;
          if (!imageUrl) {
            return null;
          }
          return {
            id: photo.id,
            title: photo.alt || photo.url,
            ownerName: photo.photographer || '',
            pageUrl: photo.url || '',
            imageUrl,
            license: PEXELS_LICENSE.name,
            licenseUrl: PEXELS_LICENSE.url,
            provider: 'Pexels'
          };
        })
        .filter(Boolean);
    };

    const providersToTry = provider === 'auto' ? ['pexels', 'openverse'] : [provider];
    let photos = [];
    let usedProvider = provider;

    for (const candidate of providersToTry) {
      try {
        if (candidate === 'pexels') {
          photos = await fetchPexels();
          usedProvider = 'pexels';
        } else if (candidate === 'openverse') {
          photos = await fetchOpenverse();
          usedProvider = 'openverse';
        } else {
          throw new Error(`Unsupported provider: ${candidate}`);
        }
        if (photos.length > 0 || provider !== 'auto') {
          break;
        }
      } catch (error) {
        if (provider !== 'auto') {
          throw error;
        }
      }
    }

    const payload = { query, provider: usedProvider, photos };
    photoCache.set(cacheKey, { timestamp: Date.now(), payload });
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Token server running on :${port}`);
  });
}

module.exports = { app };
