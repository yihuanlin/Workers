import { get } from '@vercel/edge-config';

export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET',
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
};

export default async function handler(request, env = {}) {
  const origin = request.headers.get('origin') || request.headers.get('Origin');
  const userAgent = request.headers.get('user-agent');
  const isAllowed = (!origin || origin.startsWith('file://') ||
    origin.endsWith('yhl.ac.cn') ||
    origin.startsWith('safari-web-extension://') ||
    origin.startsWith('chrome-extension://')) &&
    userAgent !== 'Fastly/cache-check';

  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Access denied' }), {
      status: 403,
      headers: corsHeaders
    });
  }

  const method = request.method;

  if (method === 'GET') {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const BLOB_ID = process.env.BLOB_ID;

    if (type === 'image') {
      const response = await fetch(`https://${BLOB_ID}.public.blob.vercel-storage.com/wallpaper.avif`);
      const imageBuffer = await response.arrayBuffer();

      return new Response(imageBuffer, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/avif'
        }
      });
    } else if (type === 'mobile') {
      const response = await fetch(`https://${BLOB_ID}.public.blob.vercel-storage.com/wallpaper-mobile.avif`);
      const imageBuffer = await response.arrayBuffer();

      return new Response(imageBuffer, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/avif'
        }
      });
    } else {
      let metadata = await get('wallpaper-metadata');
      if (!metadata) {
        const response = await fetch(`https://${BLOB_ID}.public.blob.vercel-storage.com/metadata.json`);
        metadata = await response.json();
      }

      return new Response(JSON.stringify(metadata), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: corsHeaders
  });
}
