<p align="center">
  <img src="docs/assets/scene-logo.png" alt="Scene" width="720">
</p>

# Scene

**Scene è un editor desktop locale e semplificato per creare storyboard e animatic 3D senza dover conoscere Blender.**

Permette di comporre una sequenza di scene, disporre elementi 3D e livelli 2D, impostare camera e movimenti, aggiungere audio e scrivere indicazioni precise. Il risultato è un progetto strutturato e modificabile, esportabile come file Blender e utilizzabile come base di lavoro per un agente AI.

<p align="center">
  <img src="docs/assets/scene-interface.png" alt="Interfaccia di Scene" width="1200">
</p>

## Perché nasce

Mi sono reso conto che i modelli AI più recenti sono diventati molto efficaci nel creare, modificare e organizzare contenuti 3D. Allo stesso tempo, ABACO aveva bisogno di produrre con maggiore continuità contenuti divulgativi animati per i propri canali social.

Da queste due esigenze nasce **Scene**: uno strumento pensato per trasformare un’idea in uno storyboard 3D anche senza competenze tecniche specifiche. L’obiettivo non è sostituire Blender o un software professionale di animazione, ma rendere accessibili le operazioni essenziali per preparare scene, inquadrature, tempi e indicazioni.

Il progetto prodotto da Scene può essere aperto in Blender oppure affidato al proprio agente di sviluppo preferito — per esempio Codex, Claude Code o Cursor — insieme a istruzioni dettagliate per continuare la lavorazione, aggiungere logica o rifinire la scena 3D.

Scene è ancora un software giovane e volutamente essenziale. È nato per un utilizzo concreto e circoscritto alla produzione social di ABACO; continuerà a evolversi quando emergeranno nuove necessità reali. Il codice rimane comunque disponibile a chi si trova in una situazione simile e vuole adattarlo, estenderlo o integrare servizi aggiuntivi, incluse API e automazioni proprie.

## Cosa permette di fare

- organizzare più scene su una timeline continua;
- aggiungere forme 3D, file Blender, immagini e testo 2D;
- impostare inquadratura, camera e movimenti tramite punti temporali;
- annotare scene, movimenti ed elementi con indicazioni operative;
- importare tracce audio, visualizzarne la waveform e regolarne il volume;
- riprodurre l’animatic direttamente nell’editor;
- esportare un progetto Blender versionato e una traccia audio WAV separata;
- salvare un progetto portabile, con gli asset raccolti insieme ai dati della scena.

## Flusso di lavoro

1. Crea le scene e definisci la loro durata.
2. Inserisci gli elementi e prepara le inquadrature.
3. Registra o modifica i movimenti sulla timeline.
4. Aggiungi indicazioni testuali e tracce audio.
5. Salva il progetto ed esporta il file `.blend`.
6. Continua manualmente in Blender oppure passa progetto e indicazioni a un agente AI per una lavorazione più avanzata.

I progetti sono salvati come `scene.abaco.json`. Gli export vengono creati accanto al progetto in cartelle progressive (`exports/v001`, `v002` e così via), senza sovrascrivere le versioni precedenti.

## Architettura

Scene è un’applicazione desktop basata su Electron, React e Three.js. Lo stato del progetto è validato con Zod e l’esportazione Blender viene generata da uno script Python locale e deterministico.

L’applicazione funziona anche senza una chiave API per la composizione e l’esportazione diretta. L’integrazione AI è opzionale: quando configurata, la chiave OpenAI viene cifrata tramite `safeStorage` di Electron e non viene inclusa nei file di progetto.

Il piano prodotto dal modello viene validato prima dell’applicazione: non può fornire codice Python arbitrario, scegliere percorsi locali o cancellare direttamente gli elementi del progetto.

## Sviluppo

Requisiti:

- Node.js 22 o successivo;
- npm;
- Blender.

Su macOS Scene cerca Blender automaticamente in `/Applications/Blender.app`; su Linux rileva il Flatpak `org.blender.Blender`. È possibile indicare un eseguibile differente dalle impostazioni.

```bash
npm install
npm run dev
```

## Test e pacchetti

```bash
npm test
npm run build
npm run package:linux
npm run package:mac
```

I pacchetti vengono generati in `release/`: AppImage per Linux e ZIP per macOS Apple Silicon.

## Stato del progetto

Scene è sperimentale e in sviluppo. Le funzioni disponibili sono intenzionalmente poche e orientate al flusso di lavoro interno di ABACO. Segnalazioni, adattamenti e integrazioni sono benvenuti, purché mantengano l’esperienza semplice e comprensibile anche per chi non lavora abitualmente con software 3D.
