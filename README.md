# 337-01 Estudo 04 — Reserva da Serra, Canela/RS

Visualização do estudo arquitetônico **337-01 Estudo 04** em Canela (RS).

## Conteúdo

- **`index.html`** — visualizador 3D interativo (Three.js + GLB Meshopt). Orbita, zoom, toggle de partes.
- **`337-01_Estudo_04_opt.glb`** — modelo otimizado (44 MB, comprimido do original 707 MB com `gltfpack`).
- **`renders/`** — galeria de renders fotorrealistas (Blender 5.1 + Cycles).
  - `final/` — 4 câmeras a 1920×1080, 512 samples, OIDN, AgX.
  - `test/` — testes 960×540, 64 samples.
  - `sun_study/` — variação solar ao longo do dia (cam_forro_leste + cam_fascia_leste).
- **`tools/enhance.mjs`** — pós-produção dos renders via IA (sem dependências, Node ≥18).

## Pós-produção IA (`tools/enhance.mjs`)

Pipeline: **render PNG → Nano Banana 2 (refino) → Magnific (upscale) → PNG final**.

```bash
export GEMINI_API_KEY=...      # API Gemini (Nano Banana 2 = gemini-3.1-flash-image)
export MAGNIFIC_API_KEY=...    # API Magnific (ou FREEPIK_API_KEY)

node tools/enhance.mjs renders/final/cam_eye.png --scale 4x
node tools/enhance.mjs renders/final/*.png --model pro --skip-upscale   # só refino
```

Saída em `renders/enhanced/`. Veja `node tools/enhance.mjs --help` para todas as opções
(`--prompt`, `--scale`, `--optimized-for`, `--engine`, `--creativity`, `--hdr`, `--resemblance`,
`--skip-refine`, `--skip-upscale`).

## Iluminação

Renders calculados com posição solar real para Canela:

- **Latitude/Longitude**: -29.3771, -50.8378 (altitude 830 m)
- **Data padrão**: 15/Jan/2026 (verão hemisfério sul)
- **Norte offset**: -15° (norte verdadeiro 15° à direita do topo do modelo)
- **Sky**: Blender Multiple Scattering (Nishita physical)
- **Sun**: temperatura de cor variável conforme elevação

## Pipeline (resumo)

```
GLB original (707 MB, spec-gloss, SimLab)
  → gltf-transform metalrough  (spec-gloss → metallic-roughness)
  → gltf-transform optimize     (quantize geometry)
  → gltfpack -cc -tw -tl 1024   (Meshopt + WebP + cap 1024px) → viewer
  → Blender 5.1 (Cycles + OIDN + AgX) → renders
```
