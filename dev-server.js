import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Import and adapt the Vercel API handler
async function loadAPIHandler() {
  try {
    const handlerModule = await import('./api/ai-sdk-chat.ts');
    return handlerModule.default;
  } catch (error) {
    console.error('Failed to load API handler:', error);
    return null;
  }
}

// AI SDK Chat endpoint
app.post('/api/ai-sdk-chat', async (req, res) => {
  try {
    const handler = await loadAPIHandler();
    if (!handler) {
      return res.status(500).json({ error: 'API handler not available' });
    }

    // Create Vercel-compatible request/response objects
    const vercelReq = {
      method: 'POST',
      body: req.body,
      headers: req.headers
    };

    const vercelRes = {
      status: (code) => {
        res.status(code);
        return vercelRes;
      },
      json: (data) => res.json(data),
      setHeader: (name, value) => res.set(name, value),
      end: () => res.end()
    };

    await handler(vercelReq, vercelRes);
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Development API server running on http://localhost:${PORT}`);
  console.log(`AI SDK Chat endpoint: http://localhost:${PORT}/api/ai-sdk-chat`);
});