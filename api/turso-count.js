import { createClient } from '@libsql/client';

const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
});

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
        const result = await turso.execute('SELECT COUNT(*) as count FROM followers');
        res.status(200).json({ count: result.rows[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}
