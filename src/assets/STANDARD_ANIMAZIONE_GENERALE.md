# Abc — Standard generale di animazione

Linee guida per creare scene e recitazioni coerenti, espressive e leggibili in Blender a partire da descrizioni semplici, un personaggio e, quando disponibile, un animatic o un file di scena.

**Indirizzo stilistico predefinito: cartoon caricaturale ed esagerato, con movimenti rapidi, pose marcate e corpo elastico.** Il riferimento approvato dall’utente è la versione `Abaco_Vlog_AI_Cartoon` del 15 settembre 2026. Il riferimento stabilisce il carattere della recitazione, non obbliga a riutilizzare le stesse pose, gli stessi eventi o gli stessi valori numerici in ogni scena. Le indicazioni qui riportate restano applicabili anche quando quel file non è disponibile.

L’AI deve sviluppare autonomamente la realizzazione dell’azione: l’utente non deve specificare ogni passo, posa, contatto o intervallo temporale. Questo standard integra le indicazioni della scena; le richieste esplicite dell’utente hanno precedenza.

Base dei riferimenti temporali: 24 fps. Se il progetto o l’utente specifica un’altra frequenza, rispettarla e convertire i riferimenti in modo da preservare la durata in secondi.

I valori temporali sono punti di partenza da verificare sul risultato. La qualità finale dipende dalla coerenza fra intenzione, movimento, inquadratura e ritmo; nessuna tabella sostituisce la valutazione visiva.

## 0. Interpretare frasi semplici e risolvere i dubbi

### Compito dell’AI

Trasformare ogni frase di regia in una breve sequenza di comportamenti osservabili, usando contesto, stato precedente del personaggio, geometria, rig e inquadratura. Scegliere autonomamente pose, traiettorie, appoggi, sguardo, raccordi e tempi intermedi. Non chiedere all’utente di compilare una scheda tecnica per ogni scena.

Prima di animare, ricavare per ciascuna azione:

- stimolo, intenzione, bersaglio ed eventuale cambiamento emotivo;
- stato iniziale e risultato finale richiesto;
- parti del corpo e oggetti coinvolti, compresi i contatti;
- momenti necessari a rendere comprensibile l’azione e relativa distribuzione del tempo;
- vincoli espliciti, dati indicativi e decisioni da prendere autonomamente.

Questo piano serve al lavoro dell’AI: dopo il confronto iniziale obbligatorio sulla costruzione della scena non richiede un’approvazione preventiva per ogni posa. Comunicare all’utente soltanto le interpretazioni rilevanti, le discrepanze e le domande necessarie. Non inventare eventi, oggetti narrativi, dialoghi o gag che cambino il significato della richiesta.

### Valori predefiniti e priorità

In assenza di indicazioni diverse, applicare questi criteri:

| Aspetto | Regola predefinita |
|---|---|
| Personaggio | Conservare identità, proporzioni di riferimento, caratteristiche e controlli dell’allegato; ammettere deformazioni espressive temporanee compatibili con il disegno |
| Regia | Preservare significato, ordine delle azioni e risultato narrativo |
| Tempi del progetto | Conservare fps, durata e confini delle scene; distribuire al loro interno gesti e pause |
| Punti di movimento | Usarli come guida per percorso e composizione, senza considerarli automaticamente una camminata finita |
| Contatti | Mantenere appoggi e prese coerenti nello spazio finale della scena |
| Recitazione | Usare una recitazione cartoon caricaturale ed esagerata: gesti rapidi, silhouette forti, contrasti emotivi ampi e tenute leggibili. Adottare un registro diverso quando esplicitamente richiesto dalla regia o dall’utente |
| Camera | Conservare tipo di inquadratura e funzione narrativa; ammettere piccoli adattamenti non vincolati per la leggibilità |
| Camera statica | Tenerla ferma durante l’azione; un’eventuale correzione di impostazione non autorizza un movimento camera |
| Render | Usare un render semplice e stilizzato: materiali opachi, illuminazione morbida, fondale essenziale e contorni leggibili. Evitare iperrealismo, microtexture e dettagli che distraggono dalla recitazione, salvo richiesta esplicita |

Un valore numerico non è necessariamente un vincolo artistico, ma non va neppure ignorato: capire cosa rappresenta. Un keyframe di posizione non definisce da solo appoggi, gesto o intenzione. Un salto fra snapshot non autorizza un teletrasporto del personaggio.

Fra aspetti non esplicitamente vincolati, privilegiare intenzione e contatti, poi silhouette e leggibilità, quindi fedeltà alle coordinate indicative. Adattare il minimo necessario e annotare le modifiche rilevanti. Non cambiare silenziosamente durata, tagli, destinazione narrativa o inquadrature sostanziali per risolvere un problema tecnico.

### Carattere della recitazione cartoon

Costruire il movimento a partire da pose fortemente riconoscibili. Amplificare intenzionalmente inclinazioni del corpo, apertura e chiusura degli arti, asimmetrie, sguardo e sopracciglia. La differenza fra entusiasmo, sorpresa e fastidio deve leggersi subito, anche con il personaggio piccolo nell’inquadratura.

Usare anticipazioni brevi, scatti rapidi, superamento della posa quando motivato, assestamenti elastici e pause nette. Il contrasto fra movimento e immobilità è parte dello stile. Evitare transizioni tutte ugualmente morbide, movimenti uniformemente lenti e agitazione continua.

L’esagerazione amplifica l’azione descritta. Un sobbalzo alla scoperta di qualcosa, una compressione prima di partire o un cedimento vistoso nel fastidio sono interpretazioni ammesse quando coerenti con la situazione. Non trasformarli in automatismi per ogni emozione e non aggiungere gag, oggetti o azioni che cambiano la narrazione.

Una posa neutra o i materiali realistici presenti nel modello allegato non sostituiscono questo indirizzo stilistico. Conservare l’identità del personaggio e svilupparne la recitazione secondo il registro cartoon approvato.

### Confronto iniziale obbligatorio sulla costruzione della scena

**Prima di costruire la scena o creare l’animazione, l’AI deve aprire un confronto con l’utente: presentare una breve lettura della scena, formulare da una a tre domande concrete sulla sua costruzione e attendere le risposte.** Questa fase è parte della regia richiesta dall’utente, anche quando il materiale sembra sufficiente per produrre una prima versione. Non saltarla perché esistono valori predefiniti, preset, coordinate o un riferimento stilistico già approvato.

Le domande devono riguardare scelte che cambiano ciò che si vede, selezionando quelle ancora aperte nel progetto:

- ambiente e allestimento: spazio vuoto o ambientato, elementi di sfondo, piano d’appoggio e oggetti necessari;
- sviluppo dell’azione: causa della reazione, ordine degli eventi, bersaglio dello sguardo, rapporto fra personaggio e oggetti, esito finale;
- messa in scena: relazione fra personaggio e camera, composizione, elementi da tenere visibili e libertà di adattare le posizioni indicative del proxy;
- interpretazione della recitazione: qualità o intensità specifica di un momento, se non già determinata dalle indicazioni dell’utente.

Leggere prima JSON, documenti, asset e conversazione. Non chiedere informazioni già fornite né richiedere nuovamente il registro cartoon approvato. Quando tutti i dati necessari sono espliciti, usare il confronto per una scelta registica ancora discrezionale: presentare due interpretazioni compatibili con il materiale e chiedere quale adottare, senza contraddire i vincoli. Non inventare una carenza tecnica per giustificare una domanda.

Per ogni domanda, indicare la scena interessata, il punto da decidere e l’effetto visibile; proporre quando utile due o tre alternative, con una scelta consigliata. Raggruppare le domande in un solo messaggio e lasciare la possibilità di rispondere liberamente. Non chiedere una scheda tecnica completa, valori dei controller o conferme per ogni posa.

**Dopo le domande, attendere una risposta esplicita prima di eseguire la costruzione e l’animazione dipendenti dalle scelte. Il silenzio, il tempo trascorso e un’opzione preselezionata non valgono come risposta.** Nel frattempo sono consentite lettura degli allegati, ispezione del rig e verifiche di fattibilità che non impegnino le scelte registiche. Non avviare un render di produzione come sostituto del confronto.

Una risposta come «scegli tu» delega le decisioni richieste: dichiarare brevemente le scelte e procedere. Se l’utente ha già risposto nella conversazione alle domande di costruzione di questa stessa scena, non ripeterle. Un’istruzione esplicita dell’utente a procedere senza domande ha precedenza su questo standard. Non riaprire il confronto per semplici revisioni di una scena già definita, salvo nuovi dubbi sostanziali.

### Chiarimenti successivi indispensabili

Durante il lavoro porre ulteriori domande soltanto se:

- due indicazioni obbligatorie sono incompatibili;
- non è chiaro chi agisce, su cosa o verso quale bersaglio, e le alternative producono azioni diverse;
- un’azione non entra nel tempo o nello spazio disponibile senza cambiare un vincolo;
- il rig o gli allegati non consentono un’azione essenziale e occorre scegliere un’alternativa.

Attendere la risposta per la parte interessata, proseguendo con le parti indipendenti. Dopo il confronto iniziale scegliere autonomamente piede di partenza, piccoli sfasamenti, pose intermedie, archi e valori dei controlli; verificarli senza richiedere approvazioni ripetute.

### Preset e documento allegato al progetto

I preset di emozione, azione e camera contengono descrizioni esecutive riutilizzabili; non sostituiscono la narrazione della scena e non autorizzano a riempire una descrizione narrativa vuota. Leggere sia il nome visibile sia il prompt completo incluso nell’export. Più emozioni selezionate sullo stesso personaggio formano, per impostazione predefinita, una progressione di beat nell’ordine mostrato. Non mediarle in un’unica posa: ogni passaggio deve modificare in modo riconoscibile postura, silhouette, sguardo e qualità del movimento. Sovrapporre due emozioni soltanto quando il testo libero dichiara esplicitamente la compresenza e stabilisce quale guida la recitazione. I preset di movimento descrivono azioni da collocare dentro questi beat.

Prima della rifinitura confrontare le pose principali e un’anteprima a velocità reale con l’eventuale riferimento approvato. Se emozioni e ritmo risultano più deboli, riprogettare pose e tempi prima di aggiungere dettagli. Accelerare soltanto curve già esistenti non equivale a rendere la recitazione più incalzante.

Lo standard incorporato nel progetto è una copia del documento allegato al momento del salvataggio: usarne il contenuto, senza supporre che un percorso locale contenga sempre una versione accessibile o identica. Le richieste esplicite dell’utente e le risposte di regia hanno precedenza sui preset e sulle indicazioni generali di questo documento.

## 1. Partire dall’intenzione

Prima di animare, tradurre ogni indicazione di regia in un comportamento concreto. Definire:

- **Stimolo:** che cosa vede, sente o comprende il personaggio.
- **Intenzione:** che cosa cerca di fare in risposta.
- **Emozione:** che cosa prova e con quale intensità.
- **Cambiamento:** quale differenza deve essere leggibile fra la posa iniziale e quella finale.
- **Bersaglio:** verso quale punto, oggetto o interlocutore orienta attenzione e azione.

Preferire azioni osservabili: «cerca di capire», «si trattiene», «si protegge», «si avvicina per osservare», «riconosce qualcosa che desidera».

Un’emozione non identifica automaticamente un gesto. La felicità non impone un saluto o un salto; la confusione non impone continue occhiate alternate. Scegliere il comportamento in base alla situazione.

Quando coesistono due emozioni, stabilire quale guida il movimento. Per esempio, nella curiosità accompagnata da confusione il personaggio può protendersi per osservare e interrompersi con una piccola inclinazione interrogativa.

## 2. Esprimere le emozioni con tutto il corpo

La recitazione deve essere sostenuta da postura, distribuzione del peso, direzione del busto, apertura delle braccia e qualità degli appoggi. Il viso completa e precisa questa lettura.

Per ogni passaggio costruire una posa dominante riconoscibile e caricata. Usare contrasti ampi fra compressione e distensione, apertura e chiusura, avanzamento e arretramento, simmetria e asimmetria. Cercare una silhouette chiara prima di aggiungere dettagli facciali.

| Intenzione emotiva | Possibile comportamento del corpo | Qualità del movimento | Evitare |
|---|---|---|---|
| Curiosità | Busto proteso verso lo stimolo, inclinazione evidente, sopracciglia asimmetriche | Sguardo rapido, avvicinamento deciso, pausa di osservazione | Oscillazioni e sguardi senza un bersaglio |
| Confusione | Inclinazione interrogativa marcata, occhi o sopracciglia asimmetrici, gesto aperto o interrotto | Tentativo rapido, arresto netto, tenuta interrogativa | Ripetere sempre la stessa posa di domanda |
| Nervosismo | Postura raccolta, tensione nelle braccia, peso poco risolto | Brevi impulsi separati da trattenimenti | Tremore continuo e movimenti casuali |
| Rabbia | Postura più netta, tensione concentrata, appoggi decisi | Accenti rapidi e arresti leggibili | Agitare ogni parte del corpo contemporaneamente |
| Sorpresa o paura | Occhi molto più grandi, corpo che si allunga o arretra, braccia che si aprono e poi si raccolgono; possibile sobbalzo motivato | Scatto in pochi fotogrammi, breve sospensione, assorbimento elastico e posa di reazione | Una lunga preparazione che anticipa la scoperta; salto automatico a ogni sorpresa |
| Fastidio | Corpo abbassato o compresso, spalle cedute, mani molli, occhi stretti, sopracciglia inclinate e posa asimmetrica | Cambio netto dalla reazione precedente, caduta rapida delle braccia, tenuta secca; eventuale gesto liquidatorio motivato | Limitarsi a cambiare il viso lasciando il corpo neutro |
| Sollievo | Rilascio della parte alta del corpo, apertura delle mani, peso che si assesta | Distensione progressiva e decelerazione morbida | Applicare lo stesso scatto della rabbia |
| Gioia o entusiasmo | Busto disteso, posa aperta e inclinata, gesto ampio e slancio verso lo stimolo | Preparazione breve, azione rapida, superamento della posa e assestamento elastico | Usare automaticamente salti, saluti o rimbalzi |

Questi comportamenti sono possibilità di regia, non combinazioni obbligatorie. L’ampiezza deve restare compatibile con il disegno e con l’inquadratura.

## 3. Costruire il ritmo

Organizzare il movimento in momenti leggibili: percezione, decisione, azione, assestamento e tenuta. Includere una preparazione solo quando sostiene l’intenzione.

Per un gesto cartoon breve e deciso, usare come riferimento:

| Fase | Riferimento a 24 fps | Criterio |
|---|---:|---|
| Spostamento intenzionale degli occhi | 1–2 fotogrammi | Arrivare su un bersaglio preciso e lasciare il tempo di leggerlo |
| Preparazione | 2–3 fotogrammi | Accumulare energia o chiarire la direzione; può essere assente |
| Gesto principale | 3–5 fotogrammi | Ottenere uno scatto leggibile fra pose ben distinte, conservando il percorso e i contatti |
| Superamento della posa (overshoot) | 1–2 fotogrammi, quando utile | Superare intenzionalmente la posa in funzione dell’energia; evitare un rimbalzo obbligatorio |
| Assestamento | 2–4 fotogrammi | Recuperare con elasticità e fermarsi sulla posa leggibile |
| Sfasamento fra parti | 1–2 fotogrammi | Organizzare la successione quando utile |
| Tenuta di una posa principale | Indicativamente 12–24 fotogrammi; circa 18 come punto di partenza | Separare gli scatti e consentire la lettura. Le sospensioni di passaggio possono durare meno; le pause narrative possono durare di più |

Questi intervalli non si sommano automaticamente: alcune fasi possono sovrapporsi. Uno spostamento cauto, un’esitazione o un rilascio di tensione possono richiedere tempi più lunghi. Un riflesso di sorpresa può partire senza preparazione.

Quando si annotano keyframe iniziale e finale, indicare gli estremi esplicitamente: il movimento da frame 10 a frame 15 si sviluppa su cinque intervalli temporali. Evitare ambiguità fra durata del movimento e numero di fotogrammi inclusi.

Conservare fps, durata totale e confini delle scene, salvo richiesta diversa. Per rendere i movimenti più rapidi, concentrare il gesto in meno fotogrammi e assegnare il tempo recuperato a preparazione, assestamento o tenute motivate. Il personaggio può completare prima uno spostamento e usare il tempo residuo per leggere o preparare la posa successiva, se l’istante di arrivo non è un vincolo esplicito.

La velocità può cambiare per sostenere l’esagerazione stilistica anche quando l’intenzione narrativa resta la stessa. Evitare di accelerare uniformemente l’intero filmato o di aumentare gli fps: il risultato deve derivare da una nuova distribuzione di gesti e pause. Se invece occorre far entrare più azioni nello stesso intervallo, ridurre prima le pause non essenziali senza perdere la leggibilità.

### Scegliere i valori in funzione della scena

Le durate dei gesti, l’ampiezza dei movimenti e la quantità di assestamento devono derivare da intenzione, distanza, proporzioni, rig, oggetti e dimensione del personaggio nell’immagine. Non usare gli stessi valori per tutte le scene né presentare valori non verificati come ottimali.

Distribuire prima gli eventi essenziali nel tempo disponibile. Se la sequenza è troppo affollata, eliminare dettagli secondari e rivedere le pause senza cancellare i momenti necessari alla comprensione. Se ciò non basta, chiedere quale vincolo può essere adattato; non accelerare indistintamente tutte le azioni.

## 4. Coordinare sguardo, corpo e arti

Nelle azioni volontarie lo sguardo può precedere l’orientamento del busto; braccia, polsi e dettagli completano il gesto. Nelle reazioni istintive il corpo può partire insieme allo sguardo o anticiparlo.

Stabilire una parte che guida ciascuna azione. Le altre devono accompagnarla, contrastarla o stabilizzarla per un motivo preciso.

Usare asimmetrie intenzionali e visibili: mani a quote diverse, aperture dei gomiti contrastanti, inclinazioni del corpo e distribuzione del peso coerenti. Evitare sia la simmetria automatica sia lo sfasamento applicato meccanicamente a ogni controllo.

Organizzare un accento principale per ogni passaggio narrativo. Un movimento secondario deve sostenerlo e non competere con esso.

## 5. Preservare il personaggio

Conservare il disegno, le proporzioni riconoscibili, le gerarchie e i controlli del personaggio fornito. Quando il personaggio allegato ha mani a tre ovali o altri elementi distintivi, conservarli senza sostituirli con forme generiche.

Animare attraverso i controlli disponibili. Le deformazioni devono essere intenzionali, leggibili e compatibili con il rig. Verificare che contorno, riempimento, attacchi e viso restino coerenti durante tutto il movimento.

### Deformazione elastica e viso esagerato

Usare **squash e stretch**, cioè compressione e allungamento temporanei, per preparazioni, slanci, reazioni e impatti. La compressione può allargare il corpo mentre lo abbassa; lo slancio può restringerlo mentre lo allunga. Mantenere riconoscibili disegno e massa percepita, adattando la deformazione al personaggio. Dopo l’accento recuperare la posa prevista, che può restare caricaturale: non è necessario tornare al neutro.

Deformare il corpo attraverso i suoi controlli, lasciando indipendenti gli appoggi quando devono restare fermi. Non scalare l’intero personaggio in modo da trascinare i piedi o staccare un oggetto impugnato. Far seguire alla deformazione occhi, sopracciglia, attacchi degli arti e punti di contatto delle mani con il viso.

Amplificare apertura degli occhi, forma delle sopracciglia e asimmetrie per rendere netti i cambi emotivi. Occhi molto grandi nella sorpresa e molto stretti nel fastidio sono ammessi se restano leggibili e coerenti con il disegno. Non introdurre caratteristiche assenti dal personaggio, come una bocca quando la sua assenza è essenziale alla scena.

Non trasferire automaticamente percentuali di scala o ampiezze dei cursori dalla scena di riferimento. Scegliere i valori sulle geometrie effettive e controllare le pose estreme in camera. I cursori che devono variare con continuità, come emozioni, sguardo, palpebre e prese, devono restare numerici in virgola mobile (float), con limiti coerenti: evitare assegnazioni intere che quantizzano i valori o azzerano l’intervallo utile.

In un personaggio planare, controllare le rotazioni rispetto alla camera: il disegno non deve sparire di taglio, mostrare elementi sovrapposti in modo errato o perdere la leggibilità del viso.

Non introdurre trasformazioni globali che alterino lo spazio di valutazione dei driver o dei vincoli. Verificare il personaggio nella sua collocazione finale in scena.

## 6. Controllare peso e appoggi

Durante un appoggio fermo, mantenere stabile il punto di contatto del piede con il suolo. Valutare la geometria visibile nello spazio finale della scena, includendo trasformazioni dei genitori e delle eventuali istanze: la sola immobilità di un controllo locale non dimostra che il piede sia fermo.

Prima di sollevare un piede, rendere credibile il trasferimento del peso sull’appoggio restante. Coordinare ginocchia, attacchi delle gambe e busto; evitare piedi trascinati o arti che si allungano involontariamente.

Una rotazione sul tallone o sulla punta è ammessa quando intenzionale: il contatto attivo deve restare coerente con il gesto.

Usare pieghe delle ginocchia quando servono a caricare, assorbire o esprimere tensione. Non aggiungerle automaticamente a ogni emozione.

Se la regia richiede un salto, oppure un sobbalzo è una lettura cartoon motivata della reazione, distinguere carica quando pertinente, distacco, volo, contatto e assorbimento. Entrambi i piedi devono risultare sollevati durante il volo; il corpo deve recuperare una posa leggibile dopo l’atterraggio. Una reazione improvvisa può partire senza preparazione evidente.

Sono ammessi brevi tempi sospesi in aria e assorbimenti esagerati per l’effetto cartoon, purché intenzionali e raccordati. L’esagerazione non autorizza galleggiamenti involontari, piedi che scivolano in appoggio o atterraggi senza contatto col suolo.

### Progettare camminate, avvicinamenti e allontanamenti

Una traslazione interpolata del personaggio non basta a rappresentare una camminata. Prima di animare, confrontare lunghezza del percorso, durata, proporzioni degli arti e intenzione. Ricavare da questi elementi numero dei passi, cadenza, lunghezza delle falcate e tempi di partenza e arresto. Usare unità e scala reali del progetto; evitare un numero fisso di passi per distanze diverse.

Per ogni tratto:

1. Stabilire direzione di movimento, orientamento del corpo e bersaglio dello sguardo. Non ruotare automaticamente tutto il personaggio verso la traiettoria se la regia richiede attenzione altrove.
2. Preparare l’appoggio di sostegno e trasferire il peso prima del distacco dell’altro piede.
3. Definire punti di contatto fissi nello spazio finale, alternando sostegno e avanzamento del piede. Durante il passo, usare una traiettoria di sollevamento compatibile con il suolo e la lunghezza della gamba.
4. Coordinare corpo, ginocchia e braccia con gli appoggi. I movimenti del corpo devono risultare dal passo; evitare un rimbalzo sinusoidale sovrapposto senza rapporto con i contatti.
5. Costruire partenza, eventuali cambi di ritmo e arresto. Raccordare gli ultimi passi alla posa successiva, completando l’appoggio prima di un gesto che richieda stabilità.

Per camminate cartoon più rapide, ridurre il tempo di avanzamento dei piedi e rendere più energici sollevamento, oscillazione delle braccia, preparazione e arresto. Coordinare la compressione del corpo con i passi e con l’arrivo. Ricalcolare cadenza e falcate per il nuovo tempo disponibile; evitare di velocizzare soltanto la traslazione del corpo. Un arresto può avere un superamento espressivo del busto mentre i piedi restano piantati.

Un’andatura regolare può essere intenzionale: non aggiungere variazioni casuali per renderla meno meccanica. Variare ritmo e ampiezza quando lo richiedono intenzione, accelerazione, arresto, terreno o cambio di attenzione. Anche indietreggiare, girarsi e stringere gli appoggi richiede una sequenza di sostegni credibile.

Se distanza e tempo impongono falcate implausibili, verificare prima scala e interpretazione dei dati. Poi adattare soltanto gli aspetti non vincolati. Se occorre cambiare durata, destinazione o montaggio, chiedere un chiarimento.

### Oggetti, prese, rilasci e cadute

Deducere le interazioni necessarie dalla regia senza richiedere istruzioni su ogni contatto. Per ogni oggetto manipolato distinguere avvicinamento della mano, contatto, presa, trasporto, rilascio, moto libero ed eventuale appoggio finale, includendo soltanto le fasi pertinenti.

- Durante la presa, mantenere coerente il rapporto fra mano e oggetto. Conservare visibili il contatto e le informazioni utili, come testi o simboli, evitando sia mani nascoste sia scritte coperte.
- Al rilascio, partire dalla posizione e dall’orientamento effettivamente raggiunti. Trasferire in modo coerente il movimento della mano all’oggetto; evitare salti quando cambiano parent, vincoli o sistema di animazione.
- Nel moto libero, scegliere accelerazione e rotazione in base a forma, materiale, dimensione, altezza e intenzione della scena. Un oggetto leggero può oscillare, un oggetto rigido può cadere più direttamente: non applicare lo stesso moto a tutti gli oggetti.
- All’impatto, verificare quale parte tocca per prima, come l’oggetto si assesta e se rimane stabile. Oscillazioni, rimbalzi e scivolamenti devono essere motivati, senza rotazioni continue o galleggiamenti involontari.
- Mantenere coerenti contatti e ombre durante tutta l’interazione.

Scegliere liberamente animazione manuale, vincoli o simulazione secondo il risultato necessario. Una simulazione non è una garanzia di leggibilità: verificare sempre la traiettoria finale e, se usata, rendere disponibile la cache necessaria alla consegna.

## 7. Curare traiettorie e interpolazione

Controllare il percorso delle mani, dei gomiti e degli altri punti espressivi. Gli archi devono accompagnare il gesto senza produrre compenetrazioni, allungamenti o attraversamenti della sagoma non voluti.

Scegliere l’interpolazione in funzione dell’azione. Le curve automatiche sono un punto di partenza: correggere rallentamenti eccessivi, inversioni involontarie, picchi di velocità e derive nelle tenute.

Usare un superamento della posa anche marcato quando sostiene l’energia cartoon, seguito da un recupero breve e leggibile. Stabilire ampiezza e direzione in relazione al gesto, senza applicare la stessa oscillazione a ogni controllo. Una posa trattenuta, un arresto impaurito o un gesto controllato possono richiedere un arrivo netto e una tenuta immediata.

Nei passaggi rapidi evitare rallentamenti automatici troppo lunghi che consumano quasi tutto il gesto. Distanziare maggiormente le pose intermedie durante lo scatto e curare separatamente l’arrivo. Le tenute devono mantenere fermi i controlli previsti; usare l’interpolazione costante solo dove uno stacco di posa è intenzionale, senza eliminare gli archi necessari ai contatti.

Quando si riutilizza un movimento stock, identificarne preparazione, azione e assestamento prima di rimapparne il tempo. Non aggiungere un secondo rallentamento a una transizione già interpolata. Se il movimento non è adatto al contesto, scegliere un’altra risorsa o costruire un raccordo nella scena.

## 8. Dare valore alle pause

La pausa comunica osservazione, decisione, tensione o soddisfazione. Nello stile cartoon la tenuta di una posa caricata rende leggibile lo scatto precedente e prepara quello successivo. Una posa ferma può essere la scelta più efficace; il movimento rapido non richiede agitazione continua.

Inserire respiri, battiti di palpebre e piccoli aggiustamenti solo quando rafforzano lo stato del personaggio. Evitare cicli periodici percepibili e oscillazioni globali che muovano gli appoggi.

Se una tenuta appare vuota, verificare prima la chiarezza dell’intenzione e della posa. Aggiungere movimento soltanto se introduce un’informazione utile.

## 9. Raccordare emozioni e inquadrature

Far partire ogni nuova reazione dallo stato raggiunto nella precedente: postura, appoggi, direzione dello sguardo e tensione devono avere continuità.

Un cambiamento emotivo deve avere una causa leggibile. Quando la regia descrive una scoperta o un ripensamento, costruire i passaggi pertinenti fra percezione, tentativo, interruzione, verifica, comprensione e reazione. Non inserire tutte queste fasi automaticamente: una reazione immediata può non richiedere una verifica.

Individuare il momento in cui il personaggio acquisisce la nuova informazione. Far cambiare insieme, quando motivato, intenzione, postura, sguardo e qualità del movimento; evitare di rappresentare un cambiamento importante soltanto sostituendo un’espressione facciale. Rendere il contrasto leggibile anche alla dimensione finale del personaggio nell’inquadratura.

Il ritorno al neutro è utile per alcune clip riutilizzabili, ma non è obbligatorio nelle scene narrative. Un passaggio diretto fra emozioni richiede un raccordo motivato; evitare azzeramenti o cambi di posa senza preparazione narrativa.

Quando si combinano animazioni, identificare quali controlli modifica ciascuna. Evitare azioni concorrenti sullo stesso controllo, salvo una combinazione progettata e verificata. Assegnare correttamente tutti gli slot necessari.

Usare camera e montaggio per rendere leggibile la recitazione. Un movimento camera non sostituisce il cambiamento emotivo del personaggio. Controllare che il gesto principale sia visibile nell’inquadratura e che eventuali tagli di mani o piedi siano intenzionali.

Se note di regia e keyframe forniti sono in conflitto, rendere esplicita la discrepanza e la scelta adottata. Non dichiarare conformità completa a due indicazioni incompatibili.

## 10. Procedere per verifiche successive

1. **Lettura e fattibilità:** ricavare dalle frasi semplici intenzioni e azioni, distinguere vincoli e dati indicativi, verificare compatibilità di rig, distanze e tempi. Svolgere il confronto iniziale obbligatorio secondo la sezione 0; dopo le risposte chiarire soltanto nuovi dubbi sostanziali.
2. **Pose principali:** verificare la recitazione con poche pose cartoon marcate, già nella camera prevista. Confrontare preparazione, estremo del gesto e posa di tenuta. Il corpo deve contribuire chiaramente all’emozione anche quando il viso è piccolo.
3. **Timing:** concentrare gli accenti rapidi e distribuire le tenute, controllando a velocità reale il contrasto fra scatto, assestamento e pausa.
4. **Raccordi:** costruire traiettorie, trasferimenti di peso e continuità fra le pose.
5. **Rifinitura:** aggiungere sguardo, mani, dettagli e assestamenti senza indebolire il gesto principale.
6. **Revisione del movimento:** riprodurre un’anteprima completa alla frequenza prevista, individuare i difetti e fare una seconda passata mirata su ritmo, appoggi, interazioni e cambi emotivi. Se non emergono difetti, non introdurre modifiche inutili.
7. **Verifica finale:** esportare e controllare il file video effettivamente consegnato. Dopo correzioni che cambiano il movimento, ricontrollare i passaggi modificati e la continuità dell’intera sequenza.

Correggere prima intenzione, posa e ritmo; rifinire i dettagli dopo che questi aspetti funzionano.

## 11. Criteri di qualità e consegna

### Recitazione

- Ogni passaggio ha un’intenzione comprensibile e un bersaglio coerente.
- Le emozioni si distinguono nettamente per postura, silhouette, viso e dinamica del corpo.
- La recitazione è caricaturale ed esagerata secondo il riferimento approvato, salvo indicazione esplicita diversa.
- Gli scatti rapidi sono separati da tenute leggibili; squash, stretch e overshoot sostengono l’intenzione senza deformazioni accidentali.
- Il gesto principale è leggibile a velocità reale nell’inquadratura finale.
- Pause, variazioni di intensità e raccordi hanno una funzione narrativa.
- Le azioni secondarie non distraggono dal cambiamento principale.

### Integrità tecnica

- Nessun salto involontario di posa, scivolamento degli appoggi o compenetrazione evidente.
- Sagoma, mani, attacchi e viso conservano le caratteristiche del personaggio.
- Driver, vincoli e assegnazioni delle animazioni funzionano nell’intera sequenza.
- Non compaiono curve anomale, trasformazioni inattese o dipendenze mancanti.
- Eventuali ritorni al neutro sono verificati soltanto dove richiesti.

### Verifica del risultato

Guardare la sequenza completa alla frequenza prevista dal progetto, senza salti di riproduzione. Se il render non è riproducibile fluidamente, preparare un’anteprima più leggera con la stessa durata e tutti i fotogrammi, senza accelerare o saltare il movimento. Ispezionare poi i passaggi rapidi, i contatti e le silhouette fotogramma per fotogramma. Controllare separatamente le azioni del personaggio quando il movimento camera ne rende difficile la valutazione.

Verificare anche il video esportato: durata, risoluzione, frequenza, completezza dei fotogrammi e corrispondenza con i render. Un controllo matematico o la lettura dei metadati non equivalgono a una valutazione visiva della recitazione.

La verifica visiva di immagini ferme o di campioni distribuiti lungo il video è utile, ma non sostituisce la riproduzione continua a velocità reale. Distinguere inoltre la semplice apertura o riproduzione del file da una sua effettiva valutazione visiva. L’AI non deve dichiarare di aver guardato una sequenza che non ha potuto osservare.

Se gli strumenti disponibili non permettono questa valutazione, eseguire i controlli possibili e consegnare il risultato come **prima versione da revisionare sul movimento**, indicando esplicitamente la verifica mancante. Non presentarlo come animazione completamente validata. Se è indispensabile una decisione dell’utente per proseguire, porre una domanda mirata; altrimenti rendere disponibili i file senza bloccare il lavoro completato.

Consegnare il progetto Blender modificabile e gli output richiesti, con nomi chiari e risorse necessarie disponibili. Annotare eventuali interpretazioni della regia e limiti ancora presenti.

Distinguere sempre fra verifica tecnica, valutazione visiva e approvazione artistica. Riportare soltanto i controlli effettivamente svolti; l’adozione di questo standard non implica l’approvazione automatica delle animazioni prodotte.

L’approvazione esplicita dell’utente per una versione stabilisce un riferimento artistico valido per le lavorazioni successive. Non richiedere nuovamente conferma del registro cartoon già approvato. Questa approvazione non autorizza a dichiarare eseguite verifiche tecniche o visive non svolte e non approva automaticamente ogni futura animazione.
