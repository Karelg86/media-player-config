# 🔄 Quick-Resume: Procedura Aggiornamento Dominio SORA

Questo file serve come manuale di riferimento rapido per l'IA. Delinea la procedura da seguire ogni volta che l'utente fornisce un nuovo dominio per aggiornare il modulo SORA di StreamingCommunity.

## 📝 Procedura di aggiornamento:

Quando l'utente comunica che il dominio è cambiato e fornisce quello nuovo (es. `streamingcommunityz.nuovo`):

1. **Aggiornare `main.json`** (`d:\Sora_Sulfur\Stream_Git\main.json`):
   - Sostituire il dominio corrente col nuovo dominio in campi chiave come `iconUrl`, `baseUrl`, e `searchBaseUrl`.
   - Ad esempio, `https://IL_VECCHIO_DOMINIO/it/` diventerà `https://IL_NUOVO_DOMINIO/it/`.

2. **Aggiornare `extractor.js`** (`d:\Sora_Sulfur\Stream_Git\extractor.js`):
   - Aprire il file e sostituire tutte le stringhe contenenti il vecchio dominio con quello nuovo. Questo è fondamentale per `searchResults`, le immagini in `results`, l'`href` degli episodi in `extractEpisodes`, e altre richieste.
   - Ad esempio, aggiornare da `` `https://IL_VECCHIO_DOMINIO/it/...` `` a `` `https://IL_NUOVO_DOMINIO/it/...` ``.

3. **Verificare sostituzioni**:
   - Assicurarsi che `https://cdn.IL_NUOVO_DOMINIO/...` e `https://IL_NUOVO_DOMINIO/...` formino pattern URL validi dopo l'edit.

4. **Push su GitHub (Automatico)**:
   - Eseguire i seguenti comandi nel terminale all'interno della cartella `Stream_Git` per pubblicare le modifiche online:
     ```bash
     git add .
     git commit -m "Aggiornato dominio a IL_NUOVO_DOMINIO"
     git push
     ```

5. **Avvisare l'utente**:
   - Confermare all'utente che i file sono stati aggiornati e pushati con successo su GitHub.
   - Ricordare all'utente di chiudere l'app SORA completamente (o ricaricare il modulo) affinché acquisisca il file aggiornato dal cloud.

---
**Dominio corrente configurato nei file:** `streamingcommunityz.ninja`
*(Mantenere quest'ultima riga aggiornata a ogni sostituzione così da avere facilmente identificabile il "dominio precedente")*
