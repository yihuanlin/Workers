import { kv } from '@vercel/kv';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET',
    'Access-Control-Allow-Headers': 'Content-Type'
};

export default async function handler(req, res) {
    const { method } = req;

    Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

    if (method === 'OPTIONS') {
        return res.writeHead(200, corsHeaders).end();
    }

    if (method === 'POST') {
        try {
            const { URL, PASSWORD, BATCHSIZE = 40, MAXPUTS = 200, STARTKEY = 0 } = req.body || {};
            if (!URL || !PASSWORD) return res.status(400).json({ error: 'Missing fields' });
            if (PASSWORD !== process.env.REQUIRED_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

            const response = await fetch(URL);
            if (!response.ok) return res.status(response.status).json({ error: 'Failed to fetch URL' });
            const quotes = (await response.text()).split('\n').filter(Boolean);

            let putCount = 0;
            for (let j = 0; j < quotes.length && putCount < MAXPUTS; j += BATCHSIZE) {
                const batch = quotes.slice(j, j + BATCHSIZE);
                for (let i = 0; i < batch.length && putCount < MAXPUTS; i++) {
                    const key = `sentence${j + i + STARTKEY}`;
                    await kv.set(key, batch[i]);
                    putCount++;
                }
            }

            const newLength = Math.max(STARTKEY + putCount + 1);
            await kv.set('length', newLength);

            return res.status(200).json({ success: true, totalLength: newLength, added: putCount });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    if (method === 'GET') {
        try {
            for (let attempts = 0; attempts < 3; attempts++) {
                const rand = Math.floor(Math.random() * process.env.POEM_LENGTH);
                sentence = await kv.hget('sentences', `sentence${rand}`);
                if (!sentence) {
                    sentence = await kv.get(`sentence${rand}`);
                    if (!sentence) throw new Error();
                    await kv.hset('sentences', { [`sentence${rand}`]: sentence });
                    return res.status(200).send(sentence);
                }
                if (sentence) {
                    return res.status(200).send(sentence);
                }
                return res.status(500).json({ error: 'Failed to get valid sentence' });
            }
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
        return res.status(405).json({ error: 'Method not allowed' });
    }
}
