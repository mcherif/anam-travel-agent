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

const DEFAULT_FLICKR_LICENSES = ['4', '5', '9', '10'];
const FLICKR_LICENSE_INFO = {
  1: {
    name: 'CC BY-NC-SA 2.0',
    url: 'https://creativecommons.org/licenses/by-nc-sa/2.0/'
  },
  2: {
    name: 'CC BY-NC 2.0',
    url: 'https://creativecommons.org/licenses/by-nc/2.0/'
  },
  3: {
    name: 'CC BY-NC-ND 2.0',
    url: 'https://creativecommons.org/licenses/by-nc-nd/2.0/'
  },
  4: {
    name: 'CC BY 2.0',
    url: 'https://creativecommons.org/licenses/by/2.0/'
  },
  5: {
    name: 'CC BY-SA 2.0',
    url: 'https://creativecommons.org/licenses/by-sa/2.0/'
  },
  6: {
    name: 'CC BY-ND 2.0',
    url: 'https://creativecommons.org/licenses/by-nd/2.0/'
  },
  9: {
    name: 'Public Domain Dedication (CC0)',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/'
  },
  10: {
    name: 'Public Domain Mark',
    url: 'https://creativecommons.org/publicdomain/mark/1.0/'
  }
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

    const apiKey = process.env.FLICKR_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: 'Missing FLICKR_API_KEY' });
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

    const licenseParam = (process.env.FLICKR_LICENSES || DEFAULT_FLICKR_LICENSES.join(','))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .join(',');

    const params = new URLSearchParams({
      method: 'flickr.photos.search',
      api_key: apiKey,
      text: query,
      sort: 'relevance',
      safe_search: '1',
      content_type: '1',
      media: 'photos',
      per_page: String(perPage),
      format: 'json',
      nojsoncallback: '1',
      license: licenseParam,
      extras: ['url_l', 'url_c', 'url_m', 'owner_name', 'license'].join(',')
    });

    const response = await getFetch()(`https://www.flickr.com/services/rest/?${params.toString()}`);
    const data = await response.json();
    if (!response.ok || data.stat !== 'ok') {
      res.status(502).json({ error: 'Failed to fetch Flickr photos', details: data });
      return;
    }

    const photos = (data.photos?.photo || [])
      .map((photo) => {
        const imageUrl = photo.url_l || photo.url_c || photo.url_m;
        if (!imageUrl) {
          return null;
        }
        const licenseInfo = FLICKR_LICENSE_INFO[Number(photo.license)];
        return {
          id: photo.id,
          title: photo.title,
          ownerName: photo.ownername,
          pageUrl: `https://www.flickr.com/photos/${photo.owner}/${photo.id}`,
          imageUrl,
          license: licenseInfo?.name || `License ${photo.license || ''}`.trim(),
          licenseUrl: licenseInfo?.url || ''
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
