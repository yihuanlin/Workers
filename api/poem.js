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
			let log = {
				putError: null,
				putErrorPosition: [],
			};
			for (let j = 0; j < quotes.length && putCount < MAXPUTS; j += BATCHSIZE) {
				for (let i = 0; i < BATCHSIZE && putCount < MAXPUTS; i++) {
					try {
						const index = j + i + STARTKEY;
						if (index >= quotes.length) {
							break;
						}
						const key = `sentence${index}`;
						const newQuoteObj = JSON.parse(quotes[index]);
						delete newQuoteObj._id;
						const newQuote = JSON.stringify(newQuoteObj);
						await kv.set(key, newQuote);
						putCount++;
					} catch (e) {
						log.putError = e.message;
						log.putErrorPosition.push(j + i + STARTKEY);
					}
				}
			}

			const newLength = Math.max(STARTKEY + putCount + 1);

			const status = Object.values(log).every(value => value === null || (Array.isArray(value) && value.length === 0)) ? 200 : 500;
			return new Response(
				JSON.stringify({ totalLength: newLength, added: putCount, log }),
				{ status, headers: this.corsHeaders }
			);
		} catch (e) {
			return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
		}
	}

	if (method === 'GET') {
		try {
			let sentence;
			for (let attempts = 0; attempts < 3; attempts++) {
				const rand = Math.floor(Math.random() * process.env.POEM_LENGTH);
				sentence = await kv.get(`sentence${rand}`);
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
