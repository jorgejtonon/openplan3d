# OpenPlan3D — versão com prancha técnica, VR, foto 360° e visualizador DWG

Esta cópia do [OpenPlan3D](https://github.com/laanlabs/openPlan3D) (licença MIT) acrescenta quatro recursos para apresentação e entrega de projetos de engenharia.

## O que há de novo

### 1. Prancha técnica em PDF (como plotagem do AutoCAD)
**Exportar → Prancha técnica (PDF em escala)…**

- Desenho **vetorial em escala real**: 1:20, 1:25, 1:50, 1:75, 1:100, 1:125, 1:200, 1:250 ou 1:500. A opção **Automática** escolhe a maior escala que cabe na folha.
- Folhas **A4, A3, A2, A1 e A0**, em paisagem ou retrato, com margem de encadernação de 25 mm e carimbo no canto inferior direito.
- **Carimbo**: empresa, obra, endereço, proprietário, conteúdo, responsável técnico, CREA/CAU, ART/RRT, escala, data, desenhista, revisão, folha (numeração automática 01/03…), área útil calculada e campos de assinatura do responsável técnico e do proprietário.
- **Cotas em cadeia e totais**, incluindo as espessuras das paredes (padrão brasileiro), além das cotas desenhadas no editor.
- Paredes hachuradas, portas com arco de abertura, janelas, escadas, pilares, mobiliário, nome e área de cada ambiente, escala gráfica e campo de observações.
- Opção **preto e branco (técnico)** ou colorido; uma folha por pavimento; folha extra com a **vista 3D**.
- Nome, CREA, empresa e desenhista ficam salvos no aparelho para os próximos projetos.

> **Para manter a escala, imprima em 100% (tamanho real), nunca em "ajustar à página".**

### 2. Óculos VR
Na vista **3D**, toque no ícone de **óculos**.

- **Óculos de celular (tipo Cardboard)**: a tela se divide em duas imagens e o giroscópio acompanha a cabeça. **Segure a tela** (ou o botão do óculos) para andar; **toque duas vezes** para recentralizar; **Voltar** ou **✕** para sair.
- **Óculos com navegador WebXR (Meta Quest e similares)**: abre em VR imersivo; o gatilho ou o direcional anda na direção do olhar.
- Começa no maior ambiente, olhando para a vista mais profunda, ou de onde você estava no modo passeio.

### 3. Foto 360°
Na vista **3D**, toque em **Foto 360°**. É gerado um `panorama-360.jpg` (4096 × 2048, com metadados *Photo Sphere*) que abre como foto 360° no Google Fotos, no Facebook e em aplicativos de VR. Também pode ser enviado ao cliente pelo WhatsApp.

### 4. Projetos DWG/DXF: desenhar, editar, salvar e plotar
Na tela de projetos, toque em **Visualizador DWG/DXF**. Dá para começar um **Novo projeto** ou **Abrir** um DWG/DXF do celular, do WhatsApp ou do Drive. Nada é enviado para servidor.

**Novo projeto:** escolha a unidade (metros, centímetros ou milímetros) e a escala de impressão. O desenho já vem com camadas de engenharia (EIXOS, PAREDES, ESQUADRIAS, ESTRUTURA, COTAS, TEXTOS, HACHURAS, REDE-AGUA, REDE-ESGOTO, DRENAGEM, TOPOGRAFIA, CARIMBO e AUXILIAR, que não imprime). Cotas, textos e tracejados saem no tamanho certo para a escala.

**Barra de ferramentas (embaixo, no celular):**
- **Desenho:** linha, polilinha, retângulo, círculo, arco, polígono, elipse, spline, hachura, texto, texto multilinha, linha de construção e ponto.
- **Editar:** mover, copiar, girar, espelhar, escala, paralela, **aparar**, **estender**, **concordar** (raio; 0 fecha o canto), **chanfrar**, **esticar**, **matriz** (retangular e polar), explodir, unir, quebrar, copiar propriedades, apagar, desfazer e refazer.
- **Cotar:** linear, alinhada, contínua, raio, diâmetro e angular, com vírgula decimal (mm sem casas, cm com 1, m com 2), e editar texto.
- **Zoom, Buscar, Medir e Camadas** continuam como antes.

**Como usar no celular:** toque no comando e siga a mensagem que aparece embaixo. Para marcar pontos com precisão, segure o dedo meio segundo: aparece uma mira que se prende às pontas e cruzamentos. Medidas exatas podem ser digitadas na linha de comando, como `0,0`, depois `5,0` (em metros, uma parede de 5 m). Os atalhos do AutoCAD também funcionam (TR, EX, F, MI, SC, S, X, J, BR, AR, DLI, DAL, DCO, DRA, DDI, DAN, DT, ED, MA), assim como os nomes em português (APARAR, ESTENDER, CONCORDAR...).

**Propriedades:** ao tocar num objeto aparece um painel com o tipo, o comprimento e a área. Por ele dá para trocar a camada, a cor e a espessura.

**Rascunho automático:** o desenho em edição fica guardado no aparelho alguns segundos após cada mudança e quando o app vai para o fundo. Se o celular fechar o app, a tela inicial oferece **Recuperar rascunho**.

**Salvar:**
- **DWG** nas versões AutoCAD 2013, 2018 ou 2004. O gravador é o acadrust (livre, MPL-2.0).
- **DXF**, o formato de troca que qualquer programa CAD abre.
- Os DWGs gravados foram conferidos com dois leitores independentes (LibreDWG e acadrust), inclusive uma planta com 25 mil objetos, hachuras, blocos e cotas.
- **Confira o primeiro DWG no seu DWG FastView ou AutoCAD antes de usar em entrega.** Se algo vier diferente, salve em DXF.

**Plotar PDF:**
- Folha A4 a A0.
- Escala exata de 1:1 a 1:10.000, ou automática.
- Área: o que está na tela, o desenho principal ou tudo.
- Saída em preto ou com as cores do desenho, com espessuras de linha e o **mesmo carimbo** da prancha técnica.
- Desenhos sem unidade são lidos em milímetros; se a planta estiver em metros, escolha **Metros** em "Unidade do desenho".

> Imprima sempre em **100% (tamanho real)** e confira na escala gráfica da folha.

## Instalar no Android: regras de 2026 no Brasil

Desde 30/09/2026, em celulares Android certificados no Brasil, a instalação normal de apps de desenvolvedores **não cadastrados** no Google é bloqueada. Isso vale também para APK baixado fora da Play Store. Caminhos para usar o OpenPlan3D:

1. **Sem APK (recomendado):** abra https://jorgejtonon.github.io/openplan3d/ no **Chrome**, toque no menu ⋮ e depois em **Instalar app** (ou "Adicionar à tela inicial"). O app ganha um ícone, abre em tela cheia e funciona sem internet depois da primeira abertura. Não passa pela verificação do Google.
2. **APK com cadastro gratuito (uso pessoal):** crie no [Android Developer Console](https://developer.android.com/developer-verification/guides/android-developer-console) uma conta pessoal de **distribuição limitada** (estudante ou hobby): sem taxa, sem documento, até 20 aparelhos. Em **Pacotes**, registre:
   - **Nome do pacote:** `br.com.engenheirojorgetonon.openplan3d`
   - **Impressão SHA-256 da chave:** `F5:65:BE:DF:30:0A:4B:7A:03:50:55:02:24:6C:B8:2D:DF:FA:27:0F:49:00:5E:C4:95:50:9B:14:F7:80:C1:37`
   - **Prova de posse:** o console mostra um trecho para colocar na pasta *assets* de um APK assinado com a mesma chave. Esse trecho vai em `android/app/src/main/assets/` e o GitHub gera o APK de prova.
3. **Modo avançado, sem cadastro:** ative o modo desenvolvedor, reinicie, aguarde 24 h e confirme com digital ou PIN. Depois disso, o instalador oferece **Instalar mesmo assim**.
4. **Pelo computador:** com a depuração USB ligada, `adb install OpenPlan3D.apk`. O ADB não passa pela verificação.

**Download do APK travado em 100%:** o arquivo costuma já estar em **Arquivos → Downloads**. Se não estiver:
- abra o link no Chrome de verdade (⋮ → "Abrir no Chrome"), e não na janela interna de outro app;
- espere a verificação de segurança e toque em "Baixar mesmo assim";
- ou use "Baixar novamente".

## Aplicativo para Android

### Opção A — Instalar pelo Chrome (mais simples, VR completo)
1. Abra o endereço do GitHub Pages no **Chrome do celular**.
2. Toque em **Instalar aplicativo** (botão azul na tela inicial) ou em **⋮ → Instalar app**.
3. O OpenPlan3D ganha ícone na tela inicial, abre em tela cheia e **funciona sem internet** depois da primeira abertura.

### Opção B — APK
A cada envio para `main`, o workflow **Gerar APK Android** compila o app e publica em **Releases**. Link fixo da última versão:
`https://github.com/<seu-usuario>/openplan3d/releases/latest/download/OpenPlan3D.apk`

1. Abra o link no celular e baixe o `OpenPlan3D.apk`.
2. Permita **instalar apps desconhecidos** para o navegador quando o Android pedir.
3. No app, PDFs, fotos 360° e backups são salvos em **Documentos/OpenPlan3D** e abrem o menu **Compartilhar** (WhatsApp, Drive, e-mail).
4. O botão **Voltar** do Android fecha o VR e as janelas antes de sair da tela.

**Assinatura:** o app é de uso próprio, então a chave de assinatura fica no repositório (`android/keystore`) e não precisa de senha cadastrada no GitHub. Todas as versões instalam por cima da anterior, sem perder os projetos.

> O VR imersivo WebXR (Meta Quest) funciona no navegador, não dentro do APK. No celular com óculos tipo Cardboard, os dois funcionam.

## Publicar no GitHub Pages (grátis)
1. Crie um repositório no GitHub (por exemplo, `openplan3d`) e envie este código para a branch `main`.
2. No repositório: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. A cada envio para `main`, o workflow **Publicar no GitHub Pages** roda os testes e publica em `https://<seu-usuario>.github.io/openplan3d/`.
4. No mesmo envio, o workflow **Gerar APK Android** publica o APK em Releases.

O endereço é HTTPS, necessário para o giroscópio, a tela cheia e o WebXR funcionarem no celular.

## Rodar no computador
```bash
npm ci
npm run dev            # editor em http://localhost:5173
npm test               # testes
npm run build:dwg      # gravador DWG em WebAssembly (precisa de Rust + wasm32 + wasm-bindgen; opcional)
npm run build:cad      # visualizador DWG/DXF (gera static/cad; rode antes do build do site)
STATIC_SITE=1 VITE_STATIC_SITE=1 NODE_ENV=production npx vite build   # site estático em ./site
```

## Observações
- A versão estática não tem os recursos que dependem do servidor original (links de compartilhamento com o app do iPhone e envio ao assistente).
- As estatísticas de uso (Firebase) dos autores originais ficam **desligadas** por padrão. Ative com `PUBLIC_ENABLE_ANALYTICS=true` apenas se configurar o seu próprio projeto.
- Licença MIT: mantenha o arquivo `LICENSE` ao redistribuir. O visualizador DWG inclui o LibreDWG (GPL-3.0); veja `cad/README.md`.
