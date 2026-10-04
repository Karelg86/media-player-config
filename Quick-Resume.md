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

## 🛠️ Troubleshooting noto (NON regredire!)

### ❌ "Playback stalled" / video che non parte, ma ricerca e locandine funzionano
- **Data fix:** 2026-10-04 (commit `36bb5a0`)
- **Causa:** Vixcloud risponde **403 Forbidden** sulla playlist se l'URL contiene `&h=1` (Full HD) quando l'embed dichiara `window.canPlayFHD = false`.
- **Fix in `extractStreamUrl` (`extractor.js`):** `&h=1` viene aggiunto **solo** se l'HTML dell'embed contiene `window.canPlayFHD = true`:
  ```js
  const fhd = /window\.canPlayFHD\s*=\s*true/.test(html2) ? "&h=1" : "";
  ```
- **Regola:** NON reintrodurre `&h=1` fisso nell'URL della playlist.
- **Nota:** l'URL `url:` di `window.masterPlaylist` ora può arrivare **senza** `?b=1` (es. `https://vixcloud.co/playlist/214325`): il ternario `?`/`&` lo gestisce già.
- **Prima di dare la colpa a DNS/VPN/operatore:** testare la catena con Node (iframe → embed → playlist) e controllare lo status HTTP della playlist. Se è 403, il problema è nei parametri dell'URL, non nella rete.

---
**Dominio corrente configurato nei file:** `streamingcommunityz.photography`
*(Mantenere quest'ultima riga aggiornata a ogni sostituzione così da avere facilmente identificabile il "dominio precedente")*
