# Piano: motore di movimento componibile

## Obiettivo

Sostituire il catalogo chiuso di movimenti come percorso principale con un formato intermedio (`MotionSpec`) che descrive separatamente traslazione, rotazione, traiettoria, spazio di riferimento, tempo e vincoli. Jev e Laya interpretano il linguaggio naturale; Scene conserva il controllo geometrico e genera keyframe deterministici.

## Architettura

1. **Interpretazione temporale** — divide richieste successive e simultanee senza perdere i vincoli persistenti.
2. **Decisione componibile** — interroga il modello su ogni asse e sui parametri spaziali indipendenti.
3. **MotionSpec** — normalizza la decisione in un formato stabile, salvabile e modificabile.
4. **Compilatore geometrico** — converte il MotionSpec in keyframe visibili, senza movimenti nascosti tra i punti.
5. **Validazione** — verifica scena, durata, riferimenti, traiettoria e inquadratura prima dell’applicazione atomica.
6. **Compatibilità** — i movimenti semantici esistenti rimangono come suggerimenti e fallback per i vecchi progetti.

## MotionSpec

- spazio: camera, mondo o elemento di riferimento;
- traslazione: X avanti/indietro, Y destra/sinistra, Z alto/basso;
- rotazione: X roll, Y pitch, Z yaw;
- distanza, angolo, durata ed easing;
- traiettoria: ferma, lineare, morbida, arco, orbita, inseguimento o tratto disegnato;
- riferimento opzionale;
- vincoli: guarda il riferimento, altezza costante, distanza costante.

## Fasi

- [x] Schema MotionSpec versionato e retrocompatibile.
- [x] Decisioni Jev/Laya per assi e vincoli indipendenti.
- [x] Compilazione simultanea di traslazione e rotazione.
- [x] Persistenza del MotionSpec nelle azioni di regia.
- [ ] Editor numerico del MotionSpec nel pannello Movimento.
- [ ] Libreria separata di clip per animazioni scheletriche dei personaggi.
- [ ] Valutazione di un modello text-to-motion per rig compatibili.

## Regole

- Nessuna decisione del modello modifica direttamente coordinate o keyframe.
- I prompt successivi modificano il MotionSpec persistito.
- Le durate esplicite non vengono compresse.
- Il tratto definisce la geometria; il testo definisce significato e vincoli.
- In caso di piano invalido non viene applicata alcuna modifica parziale.
