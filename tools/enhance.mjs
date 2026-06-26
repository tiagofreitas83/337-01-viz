#!/usr/bin/env node
// enhance.mjs — pipeline de pós-produção dos renders:
//   render PNG  →  Nano Banana 2 (refino fotográfico)  →  Magnific (upscale)  →  PNG final
//
// Sem dependências externas: usa fetch/fs nativos do Node >= 18 (testado em 22).
//
// Uso:
//   GEMINI_API_KEY=... MAGNIFIC_API_KEY=... \
//   node tools/enhance.mjs renders/final/cam_eye.png --prompt "..." --scale 4x
//
// Etapas podem ser puladas:
//   --skip-refine    só faz upscale no Magnific
//   --skip-upscale   só refina no Nano Banana
//
// Veja `node tools/enhance.mjs --help` para todas as opções.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, extname, join, dirname } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// APIs
// ─────────────────────────────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const MAGNIFIC_KEY = process.env.MAGNIFIC_API_KEY || process.env.FREEPIK_API_KEY;

// Nano Banana 2 = gemini-3.1-flash-image ; Nano Banana Pro = gemini-3-pro-image
const GEMINI_MODELS = {
  nano2: 'gemini-3.1-flash-image',
  pro: 'gemini-3-pro-image',
};

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = {
    prompt:
      'Photorealistic architectural visualization, refine lighting and materials, ' +
      'natural daylight, sharp clean edges, no artifacts, keep the exact same geometry, ' +
      'camera angle and composition unchanged.',
    model: 'nano2',
    scale: '4x',
    optimizedFor: '3d_renders',
    engine: 'automatic',
    creativity: 2,
    hdr: 2,
    resemblance: 6,
    fractality: 0,
    out: 'renders/enhanced',
    skipRefine: false,
    skipUpscale: false,
    pollEvery: 5000,
    pollTimeout: 600000,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--help': case '-h': o.help = true; break;
      case '--prompt': o.prompt = next(); break;
      case '--model': o.model = next(); break;            // nano2 | pro
      case '--scale': o.scale = next(); break;            // 2x | 4x | 8x | 16x
      case '--optimized-for': o.optimizedFor = next(); break;
      case '--engine': o.engine = next(); break;
      case '--creativity': o.creativity = Number(next()); break;
      case '--hdr': o.hdr = Number(next()); break;
      case '--resemblance': o.resemblance = Number(next()); break;
      case '--fractality': o.fractality = Number(next()); break;
      case '--out': o.out = next(); break;
      case '--skip-refine': o.skipRefine = true; break;
      case '--skip-upscale': o.skipUpscale = true; break;
      default:
        if (a.startsWith('--')) { console.error(`Opção desconhecida: ${a}`); process.exit(2); }
        rest.push(a);
    }
  }
  o.inputs = rest;
  return o;
}

const HELP = `
enhance.mjs — refino (Nano Banana 2) + upscale (Magnific) dos renders

  node tools/enhance.mjs <img1.png> [img2.png ...] [opções]

Opções:
  --prompt <txt>        Instrução de refino p/ o Nano Banana
  --model nano2|pro     nano2=gemini-3.1-flash-image (padrão), pro=gemini-3-pro-image
  --scale 2x|4x|8x|16x  Fator de upscale Magnific (padrão 4x)
  --optimized-for <p>   Perfil Magnific (padrão 3d_renders)
  --engine <e>          automatic|magnific_illusio|magnific_sharpy|magnific_sparkle
  --creativity <n>      -10..10 (padrão 2)
  --hdr <n>             -10..10 (padrão 2)
  --resemblance <n>     -10..10 (padrão 6 — fiel ao original)
  --fractality <n>      -10..10 (padrão 0)
  --out <dir>           Pasta de saída (padrão renders/enhanced)
  --skip-refine         Pula Nano Banana (só upscale)
  --skip-upscale        Pula Magnific (só refino)

Variáveis de ambiente:
  GEMINI_API_KEY        chave da API Gemini (Nano Banana)
  MAGNIFIC_API_KEY      chave da API Magnific (ou FREEPIK_API_KEY)
`;

// ─────────────────────────────────────────────────────────────────────────────
// Etapa 1 — Nano Banana 2 (refino / image editing)
// ─────────────────────────────────────────────────────────────────────────────
async function refine(buf, mime, opts) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY não definida (necessária para o refino).');
  const model = GEMINI_MODELS[opts.model] || opts.model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: opts.prompt },
        { inline_data: { mime_type: mime, data: buf.toString('base64') } },
      ],
    }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const parts = json?.candidates?.[0]?.content?.parts || [];
  const img = parts.find(p => p.inline_data?.data || p.inlineData?.data);
  if (!img) throw new Error(`Gemini não retornou imagem. Resposta: ${JSON.stringify(json).slice(0, 500)}`);
  const data = img.inline_data?.data || img.inlineData?.data;
  return Buffer.from(data, 'base64');
}

// ─────────────────────────────────────────────────────────────────────────────
// Etapa 2 — Magnific (upscale criativo, assíncrono)
// ─────────────────────────────────────────────────────────────────────────────
async function upscale(buf, opts) {
  if (!MAGNIFIC_KEY) throw new Error('MAGNIFIC_API_KEY não definida (necessária para o upscale).');

  const start = await fetch('https://api.magnific.com/v1/ai/image-upscaler', {
    method: 'POST',
    headers: { 'x-magnific-api-key': MAGNIFIC_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image: buf.toString('base64'),
      scale_factor: opts.scale,
      optimized_for: opts.optimizedFor,
      engine: opts.engine,
      prompt: opts.prompt,
      creativity: opts.creativity,
      hdr: opts.hdr,
      resemblance: opts.resemblance,
      fractality: opts.fractality,
    }),
  });
  if (!start.ok) throw new Error(`Magnific ${start.status}: ${await start.text()}`);

  const { data } = await start.json();
  const taskId = data?.task_id;
  if (!taskId) throw new Error(`Magnific não retornou task_id: ${JSON.stringify(data)}`);
  process.stdout.write(`  task ${taskId} `);

  // poll
  const deadline = Date.now() + opts.pollTimeout;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, opts.pollEvery));
    const poll = await fetch(`https://api.magnific.com/v1/ai/image-upscaler/${taskId}`, {
      headers: { 'x-magnific-api-key': MAGNIFIC_KEY },
    });
    if (!poll.ok) throw new Error(`Magnific poll ${poll.status}: ${await poll.text()}`);
    const { data: d } = await poll.json();
    process.stdout.write('.');
    if (d.status === 'COMPLETED') {
      const fileUrl = d.generated?.[0];
      if (!fileUrl) throw new Error('Magnific COMPLETED mas sem URL de imagem.');
      const dl = await fetch(fileUrl);
      if (!dl.ok) throw new Error(`Download upscale ${dl.status}`);
      process.stdout.write(' ok\n');
      return Buffer.from(await dl.arrayBuffer());
    }
    if (d.status === 'FAILED') throw new Error('Magnific FAILED.');
  }
  throw new Error('Magnific: timeout aguardando upscale.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || opts.inputs.length === 0) { console.log(HELP); process.exit(opts.help ? 0 : 1); }
  if (opts.skipRefine && opts.skipUpscale) { console.error('Nada a fazer: --skip-refine e --skip-upscale juntos.'); process.exit(2); }

  await mkdir(opts.out, { recursive: true });

  for (const input of opts.inputs) {
    const ext = (extname(input) || '.png').toLowerCase();
    const mime = MIME[ext] || 'image/png';
    const name = basename(input, ext);
    console.log(`\n▸ ${input}`);

    try {
      let buf = await readFile(input);

      if (!opts.skipRefine) {
        console.log(`  refino  → ${GEMINI_MODELS[opts.model] || opts.model}`);
        buf = await refine(buf, mime, opts);
      }
      if (!opts.skipUpscale) {
        console.log(`  upscale → Magnific ${opts.scale} (${opts.engine}, ${opts.optimizedFor})`);
        buf = await upscale(buf, opts);
      }

      const outPath = join(opts.out, `${name}_enhanced.png`);
      await writeFile(outPath, buf);
      console.log(`  ✓ ${outPath} (${(buf.length / 1e6).toFixed(1)} MB)`);
    } catch (e) {
      console.error(`  ✗ ${e.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
