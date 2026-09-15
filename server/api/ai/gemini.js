// server/api/ai/gemini.js
// Proxy de Gemini: la API key vive SOLO en el servidor (GEMINI_API_KEY).
// El cliente NUNCA debe poseer la key de Google.
const ALLOWED_ORIGINS = [
    'https://simon990520.github.io',
    'http://localhost:3000',
    'http://localhost:5173'
];

function resolveOrigin(origin) {
    if (origin && ALLOWED_ORIGINS.includes(origin)) return origin;
    return ALLOWED_ORIGINS[0];
}

// Límite simple en memoria por IP (por instancia serverless). No es perfecto,
// pero frena el abuso más básico; para producción usar Redis/Upstash.
const hits = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;

function rateLimited(ip) {
    const now = Date.now();
    const entry = hits.get(ip) || { count: 0, start: now };
    if (now - entry.start > WINDOW_MS) {
        entry.count = 0;
        entry.start = now;
    }
    entry.count += 1;
    hits.set(ip, entry);
    return entry.count > MAX_PER_WINDOW;
}

module.exports = async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', resolveOrigin(origin));
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'false');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    try {
        const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
            .toString().split(',')[0].trim();
        if (rateLimited(ip)) {
            return res.status(429).json({ error: 'Too Many Requests' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error('[gemini] GEMINI_API_KEY not configured');
            return res.status(500).json({ error: 'Server misconfigured: missing GEMINI_API_KEY' });
        }

        const body = req.body || {};
        const prompt = typeof body.prompt === 'string' ? body.prompt.slice(0, 4000) : '';
        if (!prompt.trim()) {
            return res.status(400).json({ error: 'Missing prompt' });
        }
        const model = /^[a-z0-9.\-]+$/i.test(body.model || '') ? body.model : 'gemini-2.0-flash';

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            console.error('[gemini] upstream error', response.status);
            return res.status(502).json({ error: 'AI upstream error' });
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
        return res.status(200).json({ success: true, text });
    } catch (err) {
        console.error('[gemini] error:', err.message);
        return res.status(500).json({ error: 'AI request failed' });
    }
};
