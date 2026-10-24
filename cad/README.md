# Visualizador DWG/DXF

Página própria do OpenPlan3D (`/cad/`) para abrir, medir, revisar e plotar desenhos DWG e DXF no
celular ou no computador. Tudo roda no aparelho; o arquivo não é enviado para servidor nenhum.

- **Leitura e edição:** [mlightcad/cad-viewer](https://github.com/mlightcad/cad-viewer) (MIT),
  com a barra de ferramentas para celular e a interface traduzida para português
  (`src/pt-dictionary.json`, aplicada por `src/i18nPt.ts`).
- **DWG:** conversor LibreDWG compilado para WebAssembly (`@mlightcad/libredwg-converter` e
  `@mlightcad/libredwg-web`, **GPL-3.0**).
- **Plotagem** (`src/plot.ts`, `src/plotMath.ts`): o desenho vetorial é colocado na área útil de uma
  folha ABNT (A4 a A0) na escala exata 1:N, com moldura, legenda, escala gráfica e o mesmo carimbo
  da prancha técnica do editor (`src/lib/utils/sheetFrame.ts`). Monocromático opcional.
- **Fontes:** as originais vêm do CDN da biblioteca quando há internet (e ficam guardadas pelo app
  instalado); sem internet, a fonte aberta Noto Sans (SIL OFL 1.1, `public/cad-data/fonts`) responde
  pelos nomes de fonte comuns.

## Gerar

```sh
npm run build:cad   # na raiz: instala e gera em static/cad, antes do build do app
```

`static/cad` não vai para o repositório; os workflows de site e APK geram a pasta a cada versão.

## Licenças

O código deste diretório segue a licença MIT do projeto. O pacote gerado em `static/cad` inclui o
LibreDWG (GPL-3.0); por isso esse pacote, como um todo, é distribuído nos termos da GPL-3.0, com o
código-fonte completo neste repositório público. Detalhes em `public/LICENCAS.txt`.
