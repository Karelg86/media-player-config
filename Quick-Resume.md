# QUICK-RESUME: Modulo Shirox / Sora — StreamingCommunity IT

> **Documento di ripristino contesto e guida operativa per Google Antigravity (PC Casa)**  
> **Versione modulo:** 1.0.5  
> **Ultimo aggiornamento:** 12 Ottobre 2026  
> **Target:** iOS Media Player **Shirox v1.0.6 (Build 117)** (compatibile anche con Sora / Luna / Mojuru)  
> **Repository GitHub:** [Karelg86/media-player-config](https://github.com/Karelg86/media-player-config)  
> **Percorso locale PC Casa:** `d:\Sora_Sulfur\Stream_Git\` (o cartella clone del repo)

---

## 1. QUADRO GENERALE & DIAGNOSI DEI PROBLEMI

### A. Dominio Attivo e CDN
- I vecchi domini `.promo` e `.rip` sono dismessi (HTTP 301 Moved Permanently).
- **Nuovo dominio attivo:** `https://streamingcommunityz.shiksha`
- **CDN locandine attivo:** `https://cdn.streamingcommunityz.shiksha/images/`

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
- **Conclusione:** Questo comportamento è un limite architetturale dell'app iOS (Shirox dovrebbe rieseguire l'estrazione all'avvio della riproduzione dal punto salvato invece di conservare l'URL finale temporaneo). Il modulo JavaScript non può aggirare la scadenza HMAC imposta dal server, ma garantisce che ogni nuova richiesta sia perfettamente funzionante.

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
  2. Caricamento sequenziale robusto (S1 già presente dal primo fetch, poi S2, S3...) per evitare race-condition nel runtime WebKit di Shirox.
  3. Shirox ora riconosce esattamente le stagioni reali (es. 5 stagioni per Breaking Bad, ciascuna con tutti i suoi episodi corretti).

---

### E. Compatibilità JavaScriptCore (iOS)
- Nei micro-contesti di `JSEngine.swift` l'oggetto globale `URL` potrebbe non essere definito o avere comportamenti anomali.
- Tutte le funzioni usano `absUrl()` e `withParams()` basate su regex e string manipulation sicura.
- Le chiamate fetch supportano sia `soraFetch` standard che `fetchv2` (con bypass Cloudflare impersonate integrato in Shirox).

---

## 2. STRUTTURA DEI FILE NEL PROGETTO

La cartella del repository GitHub (`media-player-config`) deve contenere:

```
media-player-config/
├── main.json           # Metadati modulo, icona, versione e URL GitHub raw
├── extractor.js        # Script JS eseguito da JavaScriptCore su Shirox
├── test-module.js      # Test runner locale (Node.js 18+) per testare senza push
├── Quick-Resume.md     # Questa guida tecnica
└── .gitignore          # Ignora file di test o temporanei
```

---

## 3. PROCEDURA RAPIDA: CAMBIO DOMINIO IN 2 STEP

Quando StreamingCommunity cambia dominio (es. da `.rip` a `.new`):

### ⚡ STEP 1: Modifica le 2 righe di configurazione

1. Apri `extractor.js` e modifica **solo la riga 12**:
   ```javascript
   const CONFIG = {
     BASE: "https://streamingcommunityz.shiksha", // <-- Nuovo dominio qui
     CDN: "https://cdn.streamingcommunityz.shiksha/images/",
     LANG: "it",
   };
   ```

2. Apri `main.json` e aggiorna dominio e versione:
   ```json
   {
     "version": "1.0.5",
     "iconUrl": "https://streamingcommunityz.shiksha/favicon.ico",
     "baseUrl": "https://streamingcommunityz.shiksha/it/",
     "searchBaseUrl": "https://streamingcommunityz.shiksha/it/archive?search=%s",
     ...
   }
   ```
   > ⚠️ **IMPORTANTE SULLA VERSIONE:** Shirox salva in cache `scriptContent`. Incrementare `version` (es. da `1.0.4` a `1.0.5`) è **obbligatorio** affinché Shirox scarichi la nuova versione dello script da GitHub senza dover disinstallare il modulo nell'app!

---

### ⚡ STEP 2: Test Locale e Push su Git

Prima di fare il push, verifica che tutto funzioni lanciando il test in locale:

```bash
node test-module.js "interstellar"
```

Se vedi i 4 step con segno verde (`search`, `details`, `episodes`, `stream`), esegui il commit e push su GitHub:

#### In PowerShell (Windows):
```powershell
cd "d:\Sora_Sulfur\Stream_Git"
git add main.json extractor.js Quick-Resume.md
git commit -m "Update domain to streamingcommunityz.shiksha - v1.0.5"
git push origin main
```

#### In Git Bash:
```bash
cd /d/Sora_Sulfur/Stream_Git
git add main.json extractor.js Quick-Resume.md
git commit -m "Update domain to streamingcommunityz.shiksha - v1.0.5"
git push origin main
```

---

## 4. COME TESTARE SU SHIROX DOPO IL PUSH

1. Assicurati che il push su GitHub sia completato.
2. Su iPhone/iPad, apri **Shirox**:
   - Vai nella sezione **Moduli / Extensions**.
   - Se hai incrementato la `version` in `main.json`, Shirox rileva l'aggiornamento e scarica la nuova versione del codice.
   - In alternativa, fai uno swipe verso il basso per ricaricare la lista o reinstalla il modulo dal link raw del tuo repository:
     `https://raw.githubusercontent.com/Karelg86/media-player-config/main/main.json`
3. Cerca un film o una serie (es. "Interstellar" o "Breaking Bad") e avvia la riproduzione.
4. Verifica che il lettore carichi fluidamente senza stalli di buffering.
