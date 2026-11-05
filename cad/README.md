# Visualizador DWG/DXF

Página própria do OpenPlan3D (`/cad/`) para abrir, medir, revisar e plotar desenhos DWG e DXF no
celular ou no computador. Tudo roda no aparelho; o arquivo não é enviado para servidor nenhum.

- **Leitura e edição:** [mlightcad/cad-viewer](https://github.com/mlightcad/cad-viewer) (MIT),
  com a barra de ferramentas para celular e a interface traduzida para português
  (`src/pt-dictionary.json`, aplicada por `src/i18nPt.ts`).
- **Abrir DWG:** conversor LibreDWG compilado para WebAssembly (`@mlightcad/libredwg-converter` e
  `@mlightcad/libredwg-web`, **GPL-3.0**).
- **Salvar DWG:** `dwg-writer/` (Rust) lê o DXF exportado pelo editor e grava DWG nativo com o
  [acadrust](https://github.com/hakanaktt/acadrust) (**MPL-2.0**), compilado para WebAssembly e
  executado num worker (`public/dwg/dwg-worker.js`). Gerado no build do GitHub (`npm run build:dwg`,
  precisa do alvo `wasm32-unknown-unknown` e do `wasm-bindgen`); sem ele o app salva DXF.
- **Edição** (`src/commands/`, geometria em `src/geom/`): aparar, estender, concordar, chanfrar,
  espelhar, escala, esticar, matriz, explodir, unir, quebrar, cotas (linear, alinhada, contínua, raio,
  diâmetro, angular), texto, editar texto e copiar propriedades; barra Desenho/Editar/Cotar.
- **Plotagem** (`src/plot.ts`, `src/plotMath.ts`): o desenho vetorial é colocado na área útil de uma
  folha ABNT (A4 a A0) na escala exata 1:N, com moldura, legenda, escala gráfica e o mesmo carimbo
  da prancha técnica do editor (`src/lib/utils/sheetFrame.ts`). Monocromático opcional.
- **Fontes:** as originais vêm do CDN da biblioteca quando há internet (e ficam guardadas pelo app
  instalado); sem internet, a fonte aberta Noto Sans (SIL OFL 1.1, `public/cad-data/fonts`) responde
  pelos nomes de fonte comuns.

## Gerar

```sh
npm run build:dwg   # opcional: gravador DWG em WebAssembly (Rust)
npm run build:cad   # na raiz: instala e gera em static/cad, antes do build do app
```

`static/cad` não vai para o repositório; os workflows de site e APK geram a pasta a cada versão.

## Licenças

O código deste diretório segue a licença MIT do projeto. O pacote gerado em `static/cad` inclui o
LibreDWG (GPL-3.0); por isso esse pacote, como um todo, é distribuído nos termos da GPL-3.0, com o
código-fonte completo neste repositório público. Detalhes em `public/LICENCAS.txt`.
