export const config = {
  runtime: 'edge',
  path: '/rss'
};

import { XMLParser } from 'fast-xml-parser';

const feedGroups = {
  development: 'https://journals.biologists.com/rss/site_1000005/1000005.xml',
  cell: [
    'https://www.cell.com/developmental-cell/current.rss',
    'https://www.cell.com/developmental-cell/inpress.rss',
    'https://www.cell.com/cell/current.rss',
    'https://www.cell.com/cell/inpress.rss',
    'https://www.cell.com/neuron/current.rss',
    'https://www.cell.com/neuron/inpress.rss',
    'https://www.cell.com/trends/neurosciences/current.rss',
    'https://www.cell.com/trends/neurosciences/inpress.rss',
    'https://www.cell.com/current-biology/current.rss',
    'https://www.cell.com/current-biology/inpress.rss'
  ],
  neuro: [
    'https://www.eneuro.org/rss/ahead.xml'
  ],
  reviews: [
    'https://www.annualreviews.org/rss/content/journals/cellbio/latestarticles?fmt=rss',
    'https://www.annualreviews.org/rss/content/journals/neuro/latestarticles?fmt=rss'
  ],
  elife: [
    'https://elifesciences.org/rss/digests.xml',
    'https://elifesciences.org/rss/subject/developmental-biology.xml'
  ]
};

const getRandomFeed = () => {
  const feedKeys = Object.keys(feedGroups);
  const randomKey = feedKeys[Math.floor(Math.random() * feedKeys.length)];
  let selectedFeed = feedGroups[randomKey];
  if (Array.isArray(selectedFeed)) {
    selectedFeed = selectedFeed[Math.floor(Math.random() * selectedFeed.length)];
  }
  return selectedFeed;
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
  'Cache-Control': 'private, max-age=0, stale-while-revalidate=31536000'
};

export default async function handler(request, env = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  const origin = request.headers['origin'] || request.headers['Origin'];
  const isAllowed = !origin || origin == 'file://' ||
    origin.endsWith('yhl.ac.cn');
  if (!isAllowed) {
    return new Response(
      JSON.stringify({ error: `Access denied` }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const summary = searchParams.get('s');

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    })
  }
  let url = getRandomFeed();
  let attempts = 0;
  let text;
  let response;
  let items;
  let feedRequest;

  while (attempts < 3) {
    feedRequest = new Request(url, {
      method: 'GET',
      redirect: 'follow'
    })

    try {
      response = await fetch(feedRequest, {
        next: { revalidate: 86400 }
      });
      text = await response.text();
      const parser = new XMLParser();
      const xmlDoc = parser.parse(text);
      items = xmlDoc.rss?.channel?.item || xmlDoc['rdf:RDF']?.item || [];

      if (!Array.isArray(items)) {
        items = [items];
      }

      items = items.filter(item => {
        const description = item.description || '';
        const cleanDescription = description
          .replace('ABSTRACT', '')
          .trim();
        return cleanDescription &&
          !/^<[^>]+>\s*<\/[^>]+>$/.test(cleanDescription);
      });

      if (items.length > 0) {
        break;
      } else {
        throw new Error('No items found');
      }
    } catch (e) {
      console.warn(url, e);
      // Continue to next attempt
    }

    attempts++;
    if (attempts < 3) {
      url = getRandomFeed();
    } else {
      return new Response(JSON.stringify({ error: 'Failed to fetch feed after 3 attempts' }), {
        status: 502,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  }

  const randomItem = items[Math.floor(Math.random() * items.length)];
  let title = randomItem.title
    .replace(/<i>(.*?)<\/i>/g, '<em>$1</em>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#[0-9]+;/g, (x) => String.fromCharCode(parseInt(x.match(/[0-9]+/)[0])))
    .replace(/&([a-z]{2,8});/gi, (match) => match)
    .normalize('NFKC')
    .trim();
  title = (/[.!?]$/.test(title) ? title : title + '.');


  let description = randomItem.description;
  try {
    description = decodeURIComponent(description);
  } catch (e) {
    console.warn(url, description, e);
  }
  description = description
    .replace('ABSTRACT', '')
    .replace(/<i>(.*?)<\/i>/g, '<em>$1</em>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#[0-9]+;/g, (x) => String.fromCharCode(parseInt(x.match(/[0-9]+/)[0])))
    .replace(/&([a-z]{2,8});/gi, (match) => match)
    .normalize('NFKC')
    .trim();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({
        title: title,
        link: randomItem.link.trim(),
        isGemini: false
      })));

      if (description.length > 200 && summary) {
        const geminiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Summarize the abstract for "${title}" in concise academic style, do not include question and author information: ${description}`
              }]
            }]
          })
        });
        const data = await geminiResponse.json();
        description = data.candidates[0]?.content.parts[0]?.text.replace(/\*(.*?)\*/g, '<em>$1</em>').trim();
      };
      controller.enqueue(encoder.encode(JSON.stringify({
        description: description,
        isGemini: true
      })));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Transfer-Encoding': 'chunked'
    }
  });
}