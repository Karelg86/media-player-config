# QUICK-RESUME: Modulo Shirox / Sora — StreamingCommunity IT

> **Documento di ripristino contesto e guida operativa**  
> **Versione modulo:** 1.0.9  
> **Ultimo aggiornamento:** 25 Ottobre 2026  
> **Target:** iOS Media Player **Shirox v1.0.6 (Build 123)** (compatibile anche con Sora / Luna / Mojuru)  
> **Repository GitHub:** [Karelg86/media-player-config](https://github.com/Karelg86/media-player-config)  
> **Percorso locale PC Casa:** `d:\Sora_Sulfur\Stream_Git\` (o cartella clone del repo)

---

## 1. QUADRO GENERALE & DIAGNOSI DEI PROBLEMI

### A. Dominio Attivo e CDN
- I vecchi domini `.promo` e `.rip` sono dismessi (il `.rip` ormai non risponde più, nemmeno con redirect).
- **Nuovo dominio attivo:** `https://streamingcommunityz.day`
- **CDN locandine attivo:** `https://cdn.streamingcommunityz.day/images/`
- Il controllo del dominio è automatico: vedi sezione 3.

---

### B. Risoluzione "Playback Stalled: couldn't keep buffering this stream"
Lo stallo della riproduzione video in Shirox era causato da 3 fattori tecnici concorrenti:

1. **Forzatura risoluzione fissa (`getFixedResolutionM3u8`) [RISOLTO]:**
   - Il codice precedente estraeva la master playlist e forzava la variante a risoluzione massima (1080p fissa).
   - In questo modo veniva eliminato l'**Adaptive Bitrate (ABR)** nativo di AVPlayer su iOS: alle prime oscillazioni di banda o su rete dati 4G/5G, il buffer si svuotava senza poter scendere a 720p/480p, generando il crash "Playback stalled".
   - **Fix:** Ora `extractStreamUrl` restituisce direttamente la **Master Playlist HLS**, consentendo ad AVPlayer di scalare fluidamente e mantenendo anche la selezione delle tracce audio (ITA/ENG) e sottotitoli.

2. **Parsing parametri e doppio punto interrogativo (`??`) [RISOLTO]:**
   - Le vecchie concatenazioni manuali generavano URL malformati con doppi punti interrogativi o entità HTML non decodificate (`&amp;` presente nell'attributo `src` dell'iframe genitore).
   - Vixcloud rispondeva con **HTTP 403 Forbidden** o **HTTP 410 Gone**.
   - **Fix:** Introdotte le funzioni `withParams()` e `decodeEntities()`.

3. **Flag `canPlayFHD` non autorizzato [RISOLTO]:**
   - Aggiungere forzatamente `h=1` quando il server non lo autorizzava causava il rifiuto del token da parte del server CDN Vixcloud.
   - **Fix:** Verifica esplicita con regex `/window\.canPlayFHD\s*=\s*(true|1)/i.test(html)`.

---

### C. Analisi "Riprendi la visione" (Resume Watching)
- **Sintomo:** I contenuti riprodotti da zero tramite ricerca funzionano, mentre cliccando su "Continua a guardare" lo stream va in stallo/errore.
- **Root Cause (Architettura Shirox Swift):**
  Nel codice sorgente di Shirox (`ContinueWatchingManager.swift` e `JSEngine+Streams.swift`), l'app salva in cache l'URL finale risolto (`item.streamUrl`).
  Gli stream di Vixcloud utilizzano **token HMAC con scadenza temporale (TTL)** (`token=...&expires=...`).
  Quando l'utente torna a guardare il contenuto dopo ore, il token salvato da Shirox è scaduto. Il CDN rifiuta i chunk (.ts/.m4s) con HTTP 403.
  Se invece l'utente cerca il titolo e fa play, Shirox invoca `extractStreamUrl`, che richiede una nuova pagina iframe e genera un token HMAC fresco.
- **Conclusione (originale):** limite dell'app iOS: il modulo non può aggirare la scadenza HMAC imposta dal server, ma garantisce che ogni nuova richiesta sia perfettamente funzionante.
- **Aggiornamento 14/10/2026 (da verificare sull'iPhone):** nel codice attuale di Shirox (`xibrox/Shirox`, `Views/ContinueWatchingCard.swift` → `onStreamExpired`) quando l'URL salvato non funziona più l'app richiama `extractEpisodes` sulla scheda, ritrova l'episodio tramite `href` (o numero) e chiede un nuovo stream a `extractStreamUrl`. Con una build recente di Shirox il problema dovrebbe essere risolto. Per questo gli `href` degli episodi devono restare **stabili** tra una versione e l'altra del modulo.

---

### D. Bug "Solo Episodio 1 in tutte le Season" [RISOLTO v1.0.3]
- **Sintomo:** Nelle serie TV l'interfaccia di Shirox mostrava un selettore delle stagioni anomalo in cui ogni stagione conteneva un solo episodio ("Episodio 1").
- **Root Cause (Architettura Shirox `DetailView.swift`):**
  Nei sorgenti Swift di Shirox, la funzione `detectSeasons` individua l'inizio di una nuova stagione ogni volta che il numero dell'episodio decresce o è uguale al precedente:
  ```swift
  for i in 1..<episodes.count {
      if episodes[i].number <= episodes[i - 1].number {
          seasons.append([]) // <-- Crea una nuova stagione
      }
      seasons[seasons.count - 1].append(episodes[i])
  }
  ```
  Se il modulo JS applicava un ordinamento numerico globale (`.sort((a,b) => a.number - b.number)`), tutti gli episodi 1 di tutte le stagioni venivano raggruppati all'inizio: `[1, 1, 1, 1, ...]`.
  Shirox, leggendo `1 <= 1`, creava una nuova stagione per ogni singolo elemento, isolando ogni puntata in una finta stagione!
- **Fix v1.0.3:**
  1. Rimosso l'ordinamento numerico: la lista degli episodi mantiene l'**ordine naturale per stagione**:
     `[S1E1..S1E7, S2E1..S2E13, S3E1..S3E13, ...]`
  2. Shirox ora riconosce esattamente le stagioni reali (es. 5 stagioni per Breaking Bad, ciascuna con tutti i suoi episodi corretti).
- **Aggiornamento v1.0.6:** le stagioni non si scaricano più una alla volta ma a gruppi (vedi sezione 1.F). L'ordine finale resta identico.

---

### E. Compatibilità JavaScriptCore (iOS)
- Nei micro-contesti di `JSEngine.swift` l'oggetto globale `URL` potrebbe non essere definito o avere comportamenti anomali.
- Per questo `extractor.js` non usa `URL`: `withParams()` e `decodeEntities()` lavorano solo con regex e stringhe.
- Le chiamate fetch supportano sia `soraFetch` standard che `fetchv2` (con bypass Cloudflare impersonate integrato in Shirox).

---

### F. Novità v1.0.6 (14 Ottobre 2026)
1. **Cache 15 secondi su `season-1`:** `extractDetails` ed `extractEpisodes` chiedono la stessa pagina. Ora viene scaricata una sola volta. La cache salva la richiesta *in corso*, quindi funziona anche se Shirox chiama le due funzioni nello stesso istante.
2. **Stagioni a gruppi (`SEASON_CONCURRENCY = 3`):** S2..Sn scaricate massimo 3 alla volta, risultati sempre nell'ordine [S2, S3, ...]. Compromesso tra velocità e rischio di blocco Cloudflare.
   - ⚙️ **Se Shirox dà problemi** (stagioni mancanti, errori su serie lunghe): in `extractor.js` mettere `SEASON_CONCURRENCY = 2`, oppure `1` per tornare al comportamento sequenziale della v1.0.5.
   - Test 14/10/2026: Breaking Bad (5 stagioni, 62 episodi) caricata in ~0,4 s, stagioni riconosciute correttamente [7, 13, 13, 13, 16].
3. **Isolamento `window.masterPlaylist`:** `url`, `token` ed `expires` vengono cercati solo da `window.masterPlaylist` fino alla fine del suo `<script>`, così uno script esterno nella pagina non può "rubare" il link.
   - ⚠️ Vixcloud **non** chiude il blocco con `};` (verificato 14/10/2026), quindi non usare regex basate sulle graffe.
4. **Apostrofi:** `decodeEntities` riconosce `&#39;`, `&#039;`, `&#x27;`, `&apos;` (titoli tipo "L'esorcista" ora corretti).
5. **Iframe:** `src` accettato con apici singoli o doppi.
6. **Icona autore:** ora `https://github.com/Karelg86.png` (stabile).

---

### F2. Novità v1.0.8 (25 Ottobre 2026)
1. **Retry su rete debole / sito sovraccarico:** `soraFetch` ritenta fino a **3 volte** (pausa 1 s, poi 2 s) se la rete fallisce o il server risponde `5xx`, `429` o `408`, entro ~50 s (Shirox concede 120 s a ogni funzione del modulo). Gli altri errori (`403`, `404`) non vengono ritentati. Prima un solo errore arrivava a Shirox come stream vuoto. Stesso schema già usato nei moduli manga (Mang_ITA / Mang_ENG).
   - Test mock: 503 poi ok, errore di rete poi ok, 404 non ritentato, massimo 3 tentativi.

### F3. Problema noto: episodi lenti o bloccati in AirPlay (verificato 25/10/2026)
- Vixcloud serve i segmenti video da due tipi di server, scelti **da Vixcloud per ogni episodio** (la scelta cambia nel tempo):
  - `sc-uXX-01.<nome>.boats` → dietro Cloudflare, veloce (70–145 Mbit/s);
  - `sc-uXX-01.vix-content.net` → server diretto (`nginx`), **lento** (1–24 Mbit/s) e con raffiche di errori `503`. Il 1080p richiede ~4,5 Mbit/s continui.
- Con AirPlay è la **TV** a scaricare il video (il modulo restituisce un URL senza header, quindi Shirox non usa il proxy). Sul server lento la TV si blocca; Shirox registra `Loading timeout reached`, poi `[StreamExpiry] failedToPlayToEndTime`, poi `[StallRecovery] ... resume at 0.0s`.
- Il modulo **non può** scegliere il server: `Server1` (`?ub=1`) e `Server2` (`?ab=1`) danno lo stesso dominio, e togliere `h=1` dall'URL dà `403` (il token lo include).
- Rimedi per l'utente:
  1. **Qualità 720p:** Shirox → Impostazioni → Playback Quality → Preferred Quality → `720p` (oppure menu qualità nel player). Il 720p chiede ~1,8 Mbit/s invece di 4,5. Secondo il codice di Shirox (`PlayerView.applyPreferredQuality` → `preferredPeakBitRate`) vale anche in AirPlay; da confermare sulla TV.
  2. **Duplica schermo** invece di AirPlay: il video lo scarica il telefono, che regge meglio.
- Per capire da quale server arriva un episodio: scaricare la playlist 1080p del master e guardare il dominio dei segmenti.
- Idee scartate lato modulo: forzare il proxy di Shirox (`CastProxyServer`) restituendo degli header non serve, perché il proxy passa i dati man mano senza caricare in anticipo, quindi il server resta lento uguale. Anche restituire una sola variante (es. 720p) non va bene, perché si perderebbero le tracce audio e i sottotitoli separati.

### F4. Segnalazione allo sviluppatore di Shirox (25/10/2026)
Problemi di Shirox v1.0.6 (123) verificati nel sorgente (`xibrox/Shirox`):
1. Dopo un blocco `[StallRecovery]` riparte da `0.0s` e perde la posizione salvata.
2. Se il player nativo fallisce, l'app passa a MPV anche con AirPlay attivo, e MPV manda alla TV solo l'audio.
3. L'errore è generico (`The operation could not be completed`): mancano i dettagli di `AVPlayerItem.errorLog()` (URI, stato HTTP).
4. Dopo 10 s `Loading timeout reached, forcing ready state` (`PlayerView.swift`): la TV resta nera mentre lo stream sta ancora caricando.

Proposte inviate: in AirPlay abbassare la qualità prima di ricaricare lo stream, aspettare di più prima del timeout e del passaggio a MPV, non passare a MPV con AirPlay attivo (o mostrare un avviso).

- Dove segnalare: Discord di Shirox `https://discord.com/invite/b9tZSuJj73` (canale bug/supporto, limite 2000 caratteri per messaggio) oppure una issue su GitHub `xibrox/Shirox`. Allegare i log: Impostazioni → Logs → ⋯ → Copy to Clipboard.
- Il testo completo del messaggio (inglese e italiano) è nella conversazione salvata `workflow/conversations/2026-10-25_*airplay*`.
- Stato: messaggio preparato, invio a cura dell'utente. Da segnare qui la risposta dello sviluppatore.

---

### G. Regole da NON toccare
1. Prima di `JSON.parse` sull'attributo `data-page` si sostituisce **solo** `&quot;`. `decodeEntities()` va applicato **dopo**, sui singoli campi (`name`, `plot`, `original_name`).
2. Usare sempre l'endpoint `${baseUrl}/season-1` (restituisce sia `props.title` che `props.loadedSeason`).
3. **Mai** ordinare gli episodi per `number` (vedi sezione 1.D).

---

## 2. STRUTTURA DEI FILE NEL PROGETTO

```
media-player-config/
├── main.json                       # Metadati modulo, icona, versione e URL GitHub raw
├── extractor.js                    # Script JS eseguito da JavaScriptCore su Shirox
├── test-module.js                  # Test runner locale (Node.js 18+) per testare senza push
├── Quick-Resume.md                 # Questa guida tecnica
├── .gitignore                      # Esclude backup/ e report locali dal repo
├── .github/
│   ├── workflows/
│   │   ├── check-domain.yml        # Robot: controlla il dominio ogni 6 ore e AVVISA (issue)
│   │   ├── update-domain.yml       # Robot: cambio dominio su richiesta (anche da cellulare)
│   │   └── health-check.yml        # Robot: test completo ogni giorno, AVVISA se il modulo non funziona
│   └── scripts/
│       ├── check-domain.js         # Logica del controllo
│       └── update-domain.js        # Logica della sostituzione dominio + versione
└── backup/                         # SOLO sul PC (ignorato da git): versioni precedenti
```

---

## 3. CAMBIO DOMINIO

### 🤖 Come funziona l'avviso automatico
- Ogni 6 ore GitHub esegue **Controllo dominio**. Non modifica nulla.
- Se il dominio reindirizza altrove **o non risponde più**, apre una **issue** con etichetta `dominio`, assegnata a te → arriva notifica sull'app GitHub / email.
- Se una issue di avviso è già aperta non ne apre altre.
- Lo puoi lanciare a mano: *Actions → Controllo dominio → Run workflow*.
- ⚠️ GitHub sospende i workflow programmati dopo **60 giorni senza attività** nel repo (manda una email prima). Per riattivarlo: *Actions → Controllo dominio → Enable workflow*.

### 🩺 Salute del modulo (robot giornaliero)
- Ogni giorno GitHub esegue **Salute modulo**: test offline + test completo sul sito vero (ricerca → episodi → stream).
- Se fallisce **2 volte di fila** apre una issue con etichetta `salute` (notifica su app GitHub / email): il sito ha probabilmente cambiato la struttura delle pagine e il modulo va aggiornato.
- Un solo errore isolato non genera avvisi (Cloudflare a volte blocca i server di GitHub).
- Quando il test torna a funzionare la issue si chiude da sola. Lancio manuale: *Actions → Salute modulo → Run workflow*.

### 📱 Cambio dominio da cellulare (metodo consigliato)
1. Apri il link scritto nella issue, oppure dal browser: `https://github.com/Karelg86/media-player-config/actions/workflows/update-domain.yml`  
   (dall'app GitHub: repo → **Actions** → **Aggiorna dominio**)
2. Premi **Run workflow**.
3. Scrivi il nuovo dominio **senza** `https://` (es. `streamingcommunityz.nuovo`) e conferma.
4. Il robot: sostituisce il dominio in `main.json`, `extractor.js`, `Quick-Resume.md` (CDN compreso), incrementa la versione (es. 1.0.6 → 1.0.7), lancia i test, fa commit e push e chiude la issue.
5. Su Shirox: Moduli → aggiorna.

> Se i test del robot risultano falliti, non è per forza un errore: Cloudflare a volte blocca i server di GitHub. Prova il modulo su Shirox o lancia il test dal PC.

### 💻 Cambio dominio da PC
Stesso risultato, in locale:
```bash
node .github/scripts/update-domain.js streamingcommunityz.nuovo
node test-module.js "interstellar"
node test-module.js "breaking bad"
git add main.json extractor.js Quick-Resume.md
git commit -m "Update domain to streamingcommunityz.nuovo - v1.0.7"
git push origin main
```

> ⚠️ **IMPORTANTE SULLA VERSIONE:** Shirox salva in cache `scriptContent`. Incrementare `version` in `main.json` è **obbligatorio** affinché Shirox scarichi la nuova versione dello script senza dover disinstallare il modulo. Lo script `update-domain.js` lo fa da solo; se modifichi i file a mano, ricordatelo.

---

## 4. TEST LOCALE

```bash
node test-module.js --mock            # offline: verifica apostrofi, cache, ordine stagioni, max 3 in parallelo, estrazione stream
node test-module.js "interstellar"    # live: film
node test-module.js "breaking bad"    # live: serie TV (mostra anche come Shirox vedrà le stagioni)
```
Tutte le righe devono avere ✅. Per testare una versione vecchia: `EXTRACTOR=backup/v1.0.5/extractor.js node test-module.js --mock`.

---

## 5. COME TESTARE SU SHIROX DOPO IL PUSH

1. Assicurati che il push su GitHub sia completato.
2. Su iPhone/iPad, apri **Shirox**:
   - Vai nella sezione **Moduli / Extensions**.
   - Se hai incrementato la `version` in `main.json`, Shirox rileva l'aggiornamento e scarica la nuova versione del codice.
   - In alternativa, fai uno swipe verso il basso per ricaricare la lista o reinstalla il modulo dal link raw del tuo repository:
     `https://raw.githubusercontent.com/Karelg86/media-player-config/main/main.json`
3. Cerca un film o una serie (es. "Interstellar" o "Breaking Bad") e avvia la riproduzione.
4. Verifica che il lettore carichi fluidamente senza stalli di buffering e che le stagioni siano corrette.
