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
    const cacheKey = `${query.toLowerCase()}|${perPage}`;
    const cached = photoCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < PHOTO_CACHE_TTL_MS) {
      res.json(cached.payload);
      return;
    }

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
      res.status(502).json({ error: 'Failed to fetch Openverse photos', details: data });
      return;
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const photos = results
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

    const payload = { query, photos };
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
