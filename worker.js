export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = (url.pathname.slice(1) || 'index').replace(/\//g, '');
      const modulePath = ['wallpaper', 'poem', 'rss', 'weather'].includes(path) ? 'index' : path;
      const module = await import(`./api/${modulePath}.js`);
      return await module.default(request, env, ctx);
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }
  }
}