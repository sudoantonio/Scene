# Abaco Animatic

Editor desktop locale per comporre animatic 3D, associare indicazioni a oggetti e frame, farle interpretare da GPT-6 Astra e generare scene Blender versionate.

## Sviluppo

Requisiti: Node.js 22+, npm e Blender. Su Linux viene rilevato il Flatpak
`org.blender.Blender`; su macOS viene rilevato automaticamente Blender in
`/Applications/Blender.app`. È sempre possibile indicare un eseguibile diverso
dalle impostazioni.

```bash
npm install
npm run dev
```

Configura la chiave OpenAI dalla rotella nell'app. La chiave viene cifrata tramite `safeStorage` di Electron e non viene salvata nei progetti.

## Verifica e pacchetto

```bash
npm test
npm run build
npm run package:linux
npm run package:mac
```

I pacchetti vengono creati in `release/`: AppImage per Linux e ZIP macOS per
Apple Silicon. Ogni progetto è un file `scene.abaco.json`; gli export Blender
vengono salvati accanto al progetto in `exports/v001`, `v002` e così via.

## Sicurezza del flusso AI

Astra restituisce un `BlenderPlanV1` validato. Non può fornire codice Python, cancellare oggetti o scegliere percorsi locali. Il file `.blend` viene costruito da un template locale deterministico dopo la conferma dell'utente.
