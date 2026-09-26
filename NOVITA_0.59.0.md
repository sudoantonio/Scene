# Scene 0.59.0 — consegna completa per l’AI

Apri Scene.app contenuta nello ZIP. Apri il progetto e premi **Cartella per l’AI** nella barra superiore, oppure File → Export → Cartella per l’AI. Scegli dove salvare la cartella e consegnala interamente all’AI.

La cartella contiene il progetto riapribile, lo standard di animazione, le istruzioni di regia, audio montato e clip, immagini ritagliate, livelli immagine e testo già composti, sottotitoli, modelli e anteprime. Gli originali sono conservati separatamente per continuare a modificare il progetto. I file di Blender vengono verificati e le risorse esterne incorporabili vengono incluse nella copia esportata; serve Blender configurato nell’app. Un errore nella preparazione interrompe la consegna anziché lasciare una cartella incompleta.

CAMERE.json contiene camera attiva, posizione, orientamento e focale a ogni fotogramma. IMPORTA_CAMERE.py permette di trasferirli in Blender. L’AI deve usare questi dati, senza sostituire le camere con inquadrature ricostruite.

L’audio esportato applica tagli, posizione, volume, silenziamento, ripetizioni e dissolvenze. Questi parametri vengono conservati alla riapertura del progetto. Non riapplicarli ai WAV montati. I PNG dei livelli sono già nella risoluzione finale: rispettare gli intervalli e l’ordine descritti in MEDIA_MONTATI.json.

Lo standard predefinito conserva il registro cartoon richiesto: pose marcate, accenti rapidi, anticipazioni brevi, recuperi elastici e tenute. Le azioni esportate riportano energia, regia e durate esplicite o suggerite. È possibile sostituire o disattivare lo standard. L’esportazione completa non equivale a una validazione artistica dell’animazione: la recitazione finale deve essere realizzata e osservata nel render.

## Verifiche effettuate

- 280 test automatici superati.
- Compilazione dell’app e degli script per Blender.
- Esportazione reale nell’app di audio con taglio e volume, immagini con ritaglio e livelli di testo.
- Importazione e controllo in Blender di tutti i 1.216 fotogrammi camera del JSON fornito.
- Esportazione diretta del progetto in un file Blender.
- Preparazione di una cartella completa dal JSON fornito e verifica delle impronte dei file.
- Riapertura di un progetto esportato dopo lo spostamento della cartella, tramite test automatico.

Il video Abaco_animato.mp4 fornito non è stato rigenerato. Lo script che lo aveva prodotto prendeva la posa iniziale delle camere e non trasferiva i movimenti successivi; un altro passaggio modificava anche orientamento e focale. I dati erano presenti nel JSON.

La consegna di esempio segnala inoltre un riferimento dell’azione «il personaggio salta spaventato» che puntava al personaggio stesso. Questo riferimento incoerente è stato rimosso dalla copia esportata e resta segnalato nei controlli; l’istruzione del salto è conservata.
