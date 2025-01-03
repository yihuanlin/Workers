export const config = { runtime: 'edge' };
import { kv } from '@vercel/kv';

const corsHeaders = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'POST, GET',
	'Access-Control-Allow-Headers': 'Content-Type'
};

export default async function handler(req) {
	const origin = req.headers.get('origin');
	const isAllowed = !origin || origin === 'file://' ||
		origin.endsWith('yhl.ac.cn');
	const method = req.method;

	if (!isAllowed) {
		return new Response(JSON.stringify({ error: 'Access denied' }), {
			status: 403,
			headers: corsHeaders
		});
	}

	if (method === 'OPTIONS') {
		return new Response(null, {
			status: 200,
			headers: corsHeaders
		});
	}

	if (method === 'POST') {
		try {
			const body = await req.json();
			const { URL, PASSWORD, BATCHSIZE = 40, MAXPUTS = 200, STARTKEY = 0 } = body || {};
			if (!URL || !PASSWORD) return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: corsHeaders });
			if (PASSWORD !== process.env.REQUIRED_PASSWORD) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

			const response = await fetch(URL);
			if (!response.ok) return new Response(JSON.stringify({ error: 'Failed to fetch URL' }), { status: response.status, headers: corsHeaders });
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

			return new Response(JSON.stringify({ success: true, totalLength: newLength, added: putCount }), {
				status: 200,
				headers: corsHeaders
			});
		} catch (e) {
			return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
		}
	}

	if (method === 'GET') {
		try {
			let sentence;
			for (let attempts = 0; attempts < 3; attempts++) {
				const rand = Math.floor(Math.random() * process.env.POEM_LENGTH);
				sentence = await kv.hget('sentences', `sentence${rand}`);
				if (!sentence) {
					sentence = await kv.get(`sentence${rand}`);
					if (!sentence) throw new Error();
					await kv.hset('sentences', { [`sentence${rand}`]: sentence });
					const { _id, ...sentenceWithoutId } = sentence;
					return new Response(JSON.stringify(sentenceWithoutId), { status: 200, headers: corsHeaders });
				}
				if (sentence) {
					const { _id, ...sentenceWithoutId } = sentence;
					return new Response(JSON.stringify(sentenceWithoutId), { status: 200, headers: corsHeaders });
				}
			}
			return new Response(JSON.stringify({ error: 'Failed to get valid sentence' }), { status: 500, headers: corsHeaders });
		} catch (e) {
			return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
		}
	}

	return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
}
