// server/api/bold/create-payment-link.js
// Serverless (Vercel/Netlify-style). Requiere BOLD_API_KEY en variables de entorno.
const ALLOWED_ORIGINS = [
    'https://simon990520.github.io',
    'http://localhost:3000',
    'http://localhost:5173'
];

function resolveOrigin(origin) {
    if (!origin) return ALLOWED_ORIGINS[0];
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    // Permitir cualquier subruta de github.io del proyecto si hiciera falta ampliar:
    return ALLOWED_ORIGINS[0];
}

module.exports = async (req, res) => {
    const origin = req.headers.origin;
    const allowed = resolveOrigin(origin);
    res.setHeader('Access-Control-Allow-Origin', allowed);
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
        const body = req.body || {};
        const amount = body.amount;
        const orderId = body.orderId;
        const description = body.description;
        const callbackUrl = body.callbackUrl;

        // Validación de monto: entero, mínimo 1000 COP, máximo razonable 5.000.000 COP
        const amountInt = Number.parseInt(amount, 10);
        if (!Number.isFinite(amountInt) || amountInt < 1000 || amountInt > 5000000) {
            return res.status(400).json({ error: 'Invalid amount. Must be an integer between 1000 and 5000000 COP' });
        }

        // La API key NUNCA debe estar hardcodeada. Solo variables de entorno.
        const apiKey = process.env.BOLD_API_KEY;
        if (!apiKey) {
            console.error('[bold] BOLD_API_KEY not configured');
            return res.status(500).json({ error: 'Server misconfigured: missing BOLD_API_KEY' });
        }

        // Validar callbackUrl: solo URLs https permitidas (evita open redirect)
        const DEFAULT_CALLBACK = 'https://simon990520.github.io/deseo/wallet.html?payment=success';
        let safeCallback = DEFAULT_CALLBACK;
        if (typeof callbackUrl === 'string' && /^https:\/\//i.test(callbackUrl)) {
            try {
                const u = new URL(callbackUrl);
                if (u.protocol === 'https:') safeCallback = callbackUrl;
            } catch (_) { /* usa default */ }
        }

        const reference = (typeof orderId === 'string' && orderId.trim())
            ? orderId.trim().slice(0, 120)
            : `deseo_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

        const paymentData = {
            amount_type: 'CLOSE',
            amount: {
                currency: 'COP',
                total_amount: amountInt
            },
            reference,
            description: (typeof description === 'string' && description.trim())
                ? description.trim().slice(0, 200)
                : 'Recarga de billetera Deseo',
            callback_url: safeCallback
        };

        const response = await fetch('https://integrations.api.bold.co/online/link/v1', {
            method: 'POST',
            headers: {
                'Authorization': `x-api-key ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(paymentData)
        });

        if (!response.ok) {
            // No loguear la apiKey ni el payload completo con datos sensibles.
            console.error('[bold] Bold API error', response.status);
            return res.status(502).json({ error: 'Error creating payment link', success: false });
        }

        const data = await response.json();

        return res.status(200).json({
            success: true,
            paymentLink: data.payload.payment_link,
            url: data.payload.url,
            data: data.payload
        });

    } catch (err) {
        console.error('[bold] create-payment-link error:', err.message);
        return res.status(500).json({
            error: 'Error creating payment link',
            success: false
        });
    }
};
