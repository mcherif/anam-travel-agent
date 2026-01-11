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

if (require.main === module) {
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    console.log(`Token server running on :${port}`);
  });
}

module.exports = { app };
