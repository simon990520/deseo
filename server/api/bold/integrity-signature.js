// server/api/bold/integrity-signature.js
// Genera la firma de integridad HMAC/SHA256 requerida por Bold.
// Requiere BOLD_SECRET_KEY en variables de entorno. NUNCA loguear la llave.
const crypto = require('crypto');

const ALLOWED_ORIGINS = [
    'https://simon990520.github.io',
    'http://localhost:3000',
    'http://localhost:5173'
];

function resolveOrigin(origin) {
    if (!origin) return ALLOWED_ORIGINS[0];
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    return ALLOWED_ORIGINS[0];
}

function generateBoldIntegrityHash(attributes, secretKey) {
    // Según documentación de Bold: SHA256({Identificador}{Monto}{Divisa}{LlaveSecreta})
    const orderId = attributes['data-order-id'];
    const amount = attributes['data-amount'];
    const currency = attributes['data-currency'];

    if (!orderId || !amount || !currency) {
        throw new Error('Missing required fields');
    }

    const cleanAmount = parseInt(amount.toString(), 10);
    if (isNaN(cleanAmount) || cleanAmount <= 0) {
        throw new Error('Invalid amount');
    }

    const concatenatedString = `${orderId}${cleanAmount}${currency}${secretKey}`;

    // Nota: NO loguear la cadena concatenada (contiene la llave secreta).
    return crypto.createHash('sha256').update(concatenatedString, 'utf8').digest('hex');
}

module.exports = async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', resolveOrigin(origin));
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'false');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { attributes } = req.body || {};
        if (!attributes || typeof attributes !== 'object') {
            return res.status(400).json({ error: 'Missing attributes' });
        }

        const secret = process.env.BOLD_SECRET_KEY;
        if (!secret) {
            console.error('[bold] BOLD_SECRET_KEY not configured');
            return res.status(500).json({ error: 'Server misconfigured: missing BOLD_SECRET_KEY' });
        }

        const signature = generateBoldIntegrityHash(attributes, secret);

        return res.status(200).json({ signature, method: 'basic' });
    } catch (err) {
        // Mensaje genérico al cliente; detalle mínimo en logs.
        console.error('[bold] signature error:', err.message);
        return res.status(500).json({ error: 'Internal error generating signature' });
    }
};
