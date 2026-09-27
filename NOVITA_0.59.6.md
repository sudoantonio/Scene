# Scene 0.59.6

Correzione della registrazione movimenti rispetto alla 0.59.5.

- REC spento: spostare camera/elementi modifica la posa della scena senza creare automaticamente un movimento. Rimane possibile modificare un punto esistente selezionato esplicitamente.
- REC acceso: ogni spostamento crea un punto a 0,5 secondi dal precedente; i campioni durante lo stesso gesto aggiornano il medesimo punto. Il rilascio di tasti/trascinamento o una pausa di 350 ms nell'arrivo dei campioni fissa il punto.
- La registrazione non avvia la riproduzione. Premere REC senza muovere nulla non aggiunge keyframe.
- Se il prossimo punto supera la fine scena, la durata aumenta automaticamente. Scene successive, keyframe, pose dei controller, note e riferimenti temporali vengono spostati in avanti.
- Annulla ripristina l'intera sessione, incluso l'allungamento della scena.
- I punti già presenti vengono preservati; in caso di collisione il nuovo punto cerca il successivo intervallo libero da 0,5 secondi.

Verifica: suite completa con 298 test passati; successiva verifica mirata con 33 test passati, inclusi nuovi test di due gesti WASD consecutivi con e senza camera selezionata. Build TypeScript/Vite/Electron riuscita e avvio renderer Electron senza errori. Firma locale ad hoc dell'app verificata.

Installazione: chiudere Scene, estrarre Scene-0.59.6-mac-arm64.zip e trascinare Scene.app in Applicazioni sostituendo la versione precedente. Questa consegna non modifica automaticamente l’app installata.
