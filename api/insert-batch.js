// api/insert-batch.js – minimal test version
export default async function handler(req, res) {
    // CORS headers – must be set for both OPTIONS and POST
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // For testing, just echo back the batch size
    const { batch } = req.body;
    return res.status(200).json({ inserted: batch?.length || 0 });
}
