import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function buildWorker() {
  const apiDir = join(__dirname, 'api');
  const files = await readdir(apiDir);

  let imports = new Set();
  let declarations = new Map();
  let handlers = [];
  const handlerNames = [];
  const skipPatterns = ['corsHeaders'];

  for (const file of files) {
    if (file.endsWith('.js') && file !== 'wallpaper-worker.js' && file !== 'debug.js') {
      const content = await readFile(join(apiDir, file), 'utf8');
      const exportIndex = content.indexOf('export default');
      const lines = content.substring(0, exportIndex).split('\n');

      let currentDecl = '';
      let isCollecting = false;

      for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();
        if (!trimmed) continue;

        if (skipPatterns.some(p => rawLine.includes(p))) continue;

        if (trimmed.startsWith('import ')) {
          imports.add(trimmed);
          continue;
        }

        // Start collecting when we see a function declaration
        if ((trimmed.startsWith('const ') || trimmed.startsWith('let ')) &&
          (trimmed.includes('= () =>') || trimmed.includes('= function'))) {
          isCollecting = true;
          currentDecl = rawLine;
          continue;
        }

        // Start collecting for other const/let declarations
        if ((trimmed.startsWith('const ') || trimmed.startsWith('let ')) && !isCollecting) {
          isCollecting = true;
          currentDecl = rawLine;
          continue;
        }

        if (isCollecting) {
          currentDecl += '\n' + rawLine;
          // Only match exact '}' or '};' without spaces before
          if (rawLine === '}' || rawLine === '};') {
            isCollecting = false;
            const varName = currentDecl.split(' ')[1];
            declarations.set(varName, currentDecl);
            currentDecl = '';
          }
        }
      }

      const path = file.replace('.js', '');
      handlerNames.push(path);
      const handlerFunction = content.substring(exportIndex)
        .replace('export default async function handler', `export async function ${path}`)
        .replace('export default function handler', `export async function ${path}`)
        .replace('export default', `export async function ${path}`)
        .replace(/process\.env\./g, 'env.');

      handlers.push(handlerFunction);
    }
  }

  const workerCode = `
${Array.from(imports).join('\n')}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-cache, must-revalidate',
  'Vary': 'Accept-Encoding, Query'
};

${Array.from(declarations.values()).join('\n\n')}

${handlers.join('\n\n')}

export async function index(request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams.toString();
  const redirectParams = searchParams ? \`?\${searchParams}\` : '';
  return Response.redirect(\`https://yhl.ac.cn\${redirectParams}\`, 301);
};

export default {
  ${handlerNames.join(',\n  ')},
  index,
  
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname.slice(1).replace(/\\/$/, '');
      
      if (this[path]) {
        return await this[path](request, env, ctx);
      }
      
      return await this['index'](request, env, ctx);
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};`;

  await writeFile('./worker.js', workerCode);
}

buildWorker();