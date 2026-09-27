# Scene 0.59.7

Correzione della registrazione di un elemento quando esistono già punti di movimento.

- Con REC attivo, trascinare un punto visibile del percorso aggiunge un nuovo keyframe a +0,5 secondi senza modificare il punto trascinato.
- Un elemento con un punto del percorso selezionato resta trascinabile durante REC.
- Quando REC riparte da un keyframe già salvato, non viene duplicato il punto di partenza.
- Selezionare un elemento dalla timeline o dalla vista riattiva sempre i suoi assi di trasformazione, anche dopo aver selezionato un punto del percorso.
- La barra «Present» indica quando l'elemento è visibile; non imposta la posizione finale. La posizione finale dipende dall'ultimo keyframe di movimento registrato.

Verifica: 303 test della suite completa superati, inclusi i casi «tre punti esistenti, aggiungi quarto e quinto» e «elemento appena creato, salva due spostamenti, posizione finale uguale all'ultimo».
