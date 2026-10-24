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

### 4. Visualizador DWG/DXF com plotagem (tipo DWG FastView)
Na tela de projetos, toque em **Visualizador DWG/DXF** e depois em **Abrir**. Abre arquivos do celular, do WhatsApp ou do Drive; nada é enviado para servidor.

- Zoom com dois dedos, camadas (ligar, congelar, bloquear), buscar texto, **medir** distância, área, ângulo e coordenadas, marcações de revisão (nuvem, seta, texto, selo) e edição básica (linha, polilinha, círculo, arco, cota, copiar, mover, girar…), com a linha de comando e as mensagens **em português**.
- **Mira de precisão:** segure o dedo na tela por meio segundo; aparece uma mira acima do dedo que se prende aos pontos do desenho.
- **DXF:** salva o desenho editado em DXF.
- **Plotar PDF:** folha A4 a A0, escala exata (1:1 a 1:10.000, incluindo escalas de redes e de implantação) ou automática, área "o que está na tela" ou o desenho inteiro, preto ou com as cores do desenho, espessuras de linha e o **mesmo carimbo** da prancha técnica. A janela avisa se o desenho não cabe na escala escolhida e sugere a escala que cabe.
- **Unidade do desenho:** a escala usa a unidade gravada no arquivo (INSUNITS). Desenhos sem unidade são lidos em milímetros; se a planta estiver em metros (comum em topografia e redes), escolha **Metros** em "Unidade do desenho".
- Sem internet, os textos usam uma fonte aberta parecida; com internet, as fontes originais do desenho (e elas ficam guardadas para a próxima vez).

> Como na prancha técnica, **imprima em 100% (tamanho real)**. Confira na escala gráfica da folha.

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
npm run build:cad      # visualizador DWG/DXF (gera static/cad; rode antes do build do site)
STATIC_SITE=1 VITE_STATIC_SITE=1 NODE_ENV=production npx vite build   # site estático em ./site
```

## Observações
- A versão estática não tem os recursos que dependem do servidor original (links de compartilhamento com o app do iPhone e envio ao assistente).
- As estatísticas de uso (Firebase) dos autores originais ficam **desligadas** por padrão. Ative com `PUBLIC_ENABLE_ANALYTICS=true` apenas se configurar o seu próprio projeto.
- Licença MIT: mantenha o arquivo `LICENSE` ao redistribuir. O visualizador DWG inclui o LibreDWG (GPL-3.0); veja `cad/README.md`.
