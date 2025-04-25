export const config = { runtime: 'edge' };
import { Redis } from '@upstash/redis';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, no-cache, must-revalidate',
  'Vary': 'Accept-Encoding'
};

export default async function handler(request, env = {}) {
  const origin = request.headers.get('origin') || request.headers.get('Origin');
  const userAgent = request.headers.get('user-agent');
  const isAllowed = (!origin || origin == 'file://' ||
    origin.endsWith('yhl.ac.cn')) &&
    userAgent !== 'Fastly/cache-check';

  const method = request.method;

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
      const body = await request.json();
      const { URL, PASSWORD, BATCHSIZE = 40, MAXPUTS = 200, STARTKEY = 0, DATABASE = 0 } = body || {};
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
      let kv;
      if (DATABASE === 0) {
        kv = new Redis({
          url: process.env.UPSTASH_REDIS_URL,
          token: process.env.UPSTASH_REDIS_TOKEN,
          automaticDeserialization: false
        });
      } else if (DATABASE === 1) {
        kv = new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
          automaticDeserialization: false
        });
      } else if (DATABASE === 2) {
        kv = new Redis({
          url: process.env.KV_REST_API_URL,
          token: process.env.KV_REST_API_TOKEN,
          automaticDeserialization: false
        });
      }
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
        JSON.stringify({ totalLength: newLength, added: putCount, log }), { status, headers: corsHeaders }
      );
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  if (method === 'GET') {
    let sentence, kv;
    try {
      if (env.poem) {
        for (let attempts = 0; attempts < 3; attempts++) {
          const rand = Math.floor(Math.random() * process.env.POEM_LENGTH);
          sentence = await env.poem.get(`sentence${rand}`, { cacheTtl: 31536000, type: 'json' });
          if (sentence) {
            return new Response(typeof sentence === 'string' ? sentence : JSON.stringify(sentence), { headers: corsHeaders });
          }
        }
      }
      throw new Error();
    } catch {
      kv = new Redis({
        url: process.env.UPSTASH_REDIS_URL,
        token: process.env.UPSTASH_REDIS_TOKEN,
        automaticDeserialization: false
      });
      try {
        for (let attempts = 0; attempts < 3; attempts++) {
          const rand = Math.floor(Math.random() * process.env.POEM_LENGTH);
          sentence = await kv.get(`sentence${rand}`);
          if (sentence) {
            return new Response(sentence, { status: 200, headers: corsHeaders });
          }
        }
        throw new Error();
      } catch {
        try {
          kv = new Redis({
            url: process.env.UPSTASH_REDIS_REST_URL,
            token: process.env.UPSTASH_REDIS_REST_TOKEN,
            automaticDeserialization: false
          });
          for (let attempts = 0; attempts < 3; attempts++) {
            const rand = Math.floor(Math.random() * process.env.POEM_LENGTH);
            sentence = await kv.get(`sentence${rand}`);
            if (sentence) {
              return new Response(sentence, { status: 200, headers: corsHeaders });
            }
          }
          throw new Error();
        } catch {
          try {
            kv = new Redis({
              url: process.env.KV_REST_API_URL,
              token: process.env.KV_REST_API_TOKEN,
              automaticDeserialization: false
            });
            for (let attempts = 0; attempts < 3; attempts++) {
              const rand = Math.floor(Math.random() * process.env.POEM_LENGTH);
              sentence = await kv.get(`sentence${rand}`);
              if (sentence) {
                return new Response(sentence, { status: 200, headers: corsHeaders });
              }
            }
            throw new Error('Failed to get sentence');
          } catch (e) {
            return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
          }
        }
      }
    }
  }
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
}
