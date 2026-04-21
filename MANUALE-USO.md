# Manuale d'Uso - Obsidian Sync Bidirezionale

**Versione:** 1.0
**Data:** 21 Aprile 2026
**Autore:** Enzo Amabile

---

## Indice

1. [Introduzione](#1-introduzione)
2. [Architettura del Sistema](#2-architettura-del-sistema)
3. [Requisiti](#3-requisiti)
4. [Installazione Server VPS](#4-installazione-server-vps)
5. [Installazione Agent Mac](#5-installazione-agent-mac)
6. [Utilizzo Quotidiano](#6-utilizzo-quotidiano)
7. [Web UI](#7-web-ui)
8. [Risoluzione Problemi](#8-risoluzione-problemi)
9. [Backup e Restore](#9-backup-e-restore)
10. [FAQ](#10-faq)

---

## 1. Introduzione

Obsidian Sync è un sistema di **sincronizzazione bidirezionale in tempo reale** che ti permette di:

- ✅ Sincronizzare il vault Obsidian tra Mac e VPS cloud
- ✅ Accedere alle note da qualsiasi browser su `snorkel.vaplayground.cloud`
- ✅ Modificare note dal browser e vederle apparire su Obsidian
- ✅ Supportare tutti i tipi di file: markdown, immagini, PDF, audio, video
- ✅ Zero perdita di dati grazie al sistema di conflict resolution
- ✅ Soft delete con cestino 30 giorni

### Caratteristiche Principali

| Feature | Descrizione |
|---------|-------------|
| **Real-time sync** | Modifiche sincronizzate in < 1 secondo |
| **Bidirezionale** | Mac ↔ Cloud sincronizzazione completa |
| **Conflict resolution** | Last Write Wins + copia conflitto |
| **Multi-formato** | .md, .png, .pdf, .mp3, .mp4, .zip e altri |
| **Web UI** | Editor completo nel browser |
| **Autostart** | Agent si avvia automaticamente al login Mac |

---

## 2. Architettura del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                    MAC (Locale)                             │
│                                                              │
│  ┌──────────────┐    chokidar    ┌──────────────────────┐  │
│  │   Obsidian   │ ◄────────────►│  Agent Sync (Node.js)│  │
│  │ ~/OBS_Lavoro/│   file events  │  - SQLite WAL        │  │
│  └──────────────┘                │  - WebSocket Client  │  │
│                                  │  - launchd autostart │  │
│                                  └──────────┬───────────┘  │
└─────────────────────────────────────────────┼───────────────┘
                                              │ WSS (TLS 1.3)
                                              │ API Key
┌─────────────────────────────────────────────▼───────────────┐
│                    VPS (Cloud)                              │
│                  snorkel.vaplayground.cloud                 │
│                                                              │
│  ┌──────────────────────┐    ┌──────────────────────┐      │
│  │   Sync Server        │    │   Web UI (Svelte 5)  │      │
│  │   - Express.js       │    │   - CodeMirror 6     │      │
│  │   - WebSocket Hub    │◄──►│   - Markdown Preview │      │
│  │   - SQLite WAL       │    │   - Full-text Search │      │
│  └──────────┬───────────┘    └──────────────────────┘      │
│             │                                                 │
│  ┌──────────▼───────────┐                                  │
│  │   File Store         │                                  │
│  │   /data/vault/       │                                  │
│  │   /data/trash/       │                                  │
│  └──────────────────────┘                                  │
└─────────────────────────────────────────────────────────────┘
```

### Flusso Dati

**Locale → Cloud (Obsidian → Browser)**
1. Modifichi nota in Obsidian → salva su disco
2. `chokidar` rileva cambiamento in ~50ms
3. Agent calcola SHA-256 e confronta con DB locale
4. Se hash diverso → invia via WebSocket al server
5. Server salva in `/data/vault/` e aggiorna SQLite
6. Server broadcast a tutti i client connessi
7. Browser riceve aggiornamento e ricarica nota

**Cloud → Locale (Browser → Obsidian)**
1. Modifichi nota nel browser (CodeMirror)
2. Autosave 500ms → invia via WebSocket
3. Server salva e broadcast
4. Agent riceve messaggio (esclude echo con session_id)
5. Agent scrive file su disco
6. `chokidar` rileva ma ignora (hash già in DB locale)

---

## 3. Requisiti

### Server VPS

- **OS:** Linux (Dokploy compatible)
- **Node.js:** 20.x o superiore
- **RAM:** Minimo 512MB (raccomandato 1GB)
- **Disk:** Minimo 1GB (dipende dalla dimensione vault)
- **Docker:** Required (Dokploy fornisce questo)
- **Dominio:** snorkel.vaplayground.cloud con SSL

### Mac (Agent)

- **OS:** macOS 10.15+ (Catalina o superiore)
- **Node.js:** 20.x o superiore
- **Vault Obsidian:** Directory (es: `/Users/enzo/OBS_Lavoro/`)
- **Network:** Connessione internet attiva

### Browser (Web UI)

- Chrome/Edge 90+, Firefox 88+, Safari 14+
- JavaScript abilitato
- WebSocket supportati

---

## 4. Installazione Server VPS

### 4.1 Clone Repository

```bash
# Git clone del repository
cd /opt
git clone https://github.com/enzoamabile/obssyncro.git
cd obssyncro/server
```

### 4.2 Configurazione Environment

```bash
# Copia template .env
cp .env.example .env

# Genera segreti
API_KEY=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)

# Genera hash password admin
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('TUA_PASSWORD', 12).then(h => console.log(h))"

# Edita .env
nano .env
```

Compila il file `.env`:

```bash
# Server configuration
NODE_ENV=production
PORT=3000

# File storage paths
VAULT_ROOT=/data/vault
TRASH_PATH=/data/trash
DB_PATH=/data/state.db

# Maximum file size in MB
MAX_FILE_SIZE_MB=100

# Security secrets (generati sopra)
API_KEY=<tuo_api_key_hex>
JWT_SECRET=<tuo_jwt_secret_hex>

# Admin user
ADMIN_EMAIL=enzoamabile@gmail.com
ADMIN_PASSWORD_HASH=<tuo_bcrypt_hash>
```

### 4.3 Deploy con Dokploy

1. **Crea nuova applicazione** in Dokploy
2. **Configura:**
   - **Repository:** `https://github.com/enzoamabile/obssyncro.git`
   - **Branch:** `main`
   - **Build Command:** `cd server && docker compose build`
   - **Start Command:** `cd server && docker compose up -d`
   - **Port:** `3000`
   - **Domain:** `snorkel.vaplayground.cloud`

3. **Environment Variables** (in Dokploy):
   - Aggiungi tutte le variabili dal file `.env`
   - **NON** aggiungere mai il file `.env` al git!

4. **Deploy:**
   - Click "Deploy"
   - Dokploy clonerà il repo, buildarerà l'immagine Docker, e avvierà il container

### 4.4 Verifica Installazione

```bash
# Test health endpoint
curl https://snorkel.vaplayground.cloud/health

# Dovresti ricevere:
# {"status":"ok","timestamp":"...","uptime":...,"env":"production"}
```

---

## 5. Installazione Agent Mac

### 5.1 Clone Repository

```bash
# Clona nella directory SVILUPPO
cd /Users/enzo/SVILUPPO
git clone https://github.com/enzoamabile/obssyncro.git
cd obssyncro/agent
```

### 5.2 Installa Dipendenze

```bash
npm install
```

### 5.3 Configurazione Agent

```bash
# Copia template
cp .env.example .env

# Edita .env
nano .env
```

Compila `.env`:

```bash
# Vault configuration
VAULT_ROOT=/Users/enzo/OBS_Lavoro

# Server WebSocket URL (usa wss:// per production)
SERVER_URL=wss://snorkel.vaplayground.cloud/ws

# API Key (DEVE essere uguale a quella del server!)
API_KEY=<stesso_api_key_del_server>

# Local state database
DB_PATH=/Users/enzo/.obsidian-sync-state.db
```

**⚠️ IMPORTANTE:** `API_KEY` deve essere **identica** su server e agent!

### 5.4 Test Manuale

```bash
# Avvia agent in foreground (per vedere log)
npm start
```

Dovresti vedere:

```
🚀 Obsidian Sync Agent starting...
📁 Vault: /Users/enzo/OBS_Lavoro
🌐 Server: wss://snorkel.vaplayground.cloud/ws
🔌 Connecting to wss://snorkel.vaplayground.cloud/ws...
✅ Connected to server
📝 Session ID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
📋 Preparing initial sync...
📊 Sync delta: X files to push, Y files to pull
👀 Starting file watcher...
✅ Watcher ready
```

Premi `Ctrl+C` per fermare l'agent.

### 5.5 Configura launchd (Autostart)

```bash
# Copia plist in LaunchAgents
cp com.enzo.obsidian-sync.plist ~/Library/LaunchAgents/

# Carica il servizio
launchctl load ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist

# Verifica che sia in esecuzione
launchctl list | grep obsidian-sync
```

**Comandi launchd utili:**

```bash
# Stop agent
launchctl unload ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist

# Start agent
launchctl load ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist

# Riavvia agent
launchctl unload ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
launchctl load ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist

# Vedi log
tail -f /tmp/obsidian-sync.log
```

---

## 6. Utilizzo Quotidiano

### 6.1 Flusso Tipico

1. **Apri Obsidian** sul Mac
2. **Modifica una nota** come fai normalmente
3. **Salva** (Cmd+S o autosave Obsidian)
4. **Automaticamente** (in < 1 secondo):
   - Agent rileva il cambio
   - Calcola hash del file
   - Invia al server via WebSocket
   - Server aggiorna vault
   - Tutti i browser connessi ricevono aggiornamento

### 6.2 Accesso Web UI

1. **Apri browser:** https://snorkel.vaplayground.cloud
2. **Login** con email (`enzoamabile@gmail.com`) e password
3. **Naviga** il vault nella sidebar sinistra
4. **Modifica** note come in Obsidian
5. **Autosave** ogni 500ms - sincronizzazione automatica!

### 6.3 Creazione Nuovi File

**Da Obsidian (Mac):**
- Crea file normalmente (Cmd+N)
- Salva con nome
- Agent rileva e sincronizza automaticamente

**Da Web UI:**
- Click `[+ Nuova nota]` nella sidebar
- Inserisci nome file
- Editor si apre automaticamente
- Scrivi e salva (autosave)

### 6.4 Gestione Cartelle

**Creazione:**
- Web UI: `[+ Nuova cartella]`
- Obsidian: crea normalmente dal Finder

**Spostamento:**
- Web UI: drag & drop nella sidebar
- Obsidian: sposta dal Finder

**⚠️ NOTA:** Le cartelle sono virtuali nel filesystem, quindi gli spostamenti dal Finder sono sincronizzati ma potrebbero richiedere qualche secondo in più.

### 6.5 Cestino (Soft Delete)

**Eliminazione file:**
1. File viene spostato in `/data/trash/{timestamp}/`
2. Rimane nel cestino per **30 giorni**
3. Puoi ripristinare dalla Web UI (sezione Cestino)

**Ripristino:**
- Web UI → Cestino → Click file → "Ripristina"

**Eliminazione permanente:**
- Dopo 30 giorni file viene eliminato automaticamente
- Puoi eliminare manualmente dal cestino

---

## 7. Web UI

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────────┐
│  snorkel.vaplayground.cloud                      ● Online    │
├────────────────────────┬────────────────────────────────────┤
│  🔍 Cerca nelle note...│  [✏ Editor] [👁 Preview] [⧉ Split] │
├────────────────────────┼────────────────────────────────────┤
│  📁 Lavoro             │  # Titolo Nota                      │
│    📄 Nota1.md      ◄──│  Contenuto della nota...            │
│    📄 Nota2.md         │                                      │
│  📁 Personale         │  [[Link ad altra nota]]             │
│  📁 Progetti          │                                      │
│  ─────────────────────│                                      │
│  🗑  Cestino (2)       │                                      │
│  ⚠  Conflitti (0)     │                                      │
│                        │                                      │
│  [+ Nuova nota]        │                                      │
│  [📁 Nuova cartella]   │                                      │
└────────────────────────┴────────────────────────────────────┘
```

### 7.2 Componenti

**Sidebar (Sinistra):**
- 🔍 **Search Bar:** Ricerca full-text istantanea (Cmd+K)
- 📁 **File Tree:** Albero cartelle e file
- 🗑️ **Cestino:** File eliminati (ripristinabili)
- ⚠️ **Conflitti:** File con conflitti da risolvere

**Area Principale:**
- **Editor Mode:** CodeMirror 6 (come Obsidian)
- **Preview Mode:** Render markdown con sintassi highlighting
- **Split View:** Editor + Preview affiancati

**Features Editor:**
- Syntax highlighting markdown
- Wikilink autocompletion (`[[` suggerisce file)
- Shortcut Obsidian:
  - `Cmd+B` → Bold
  - `Cmd+I` → Italic
  - `Cmd+K` → Search
  - `Cmd+S` → Save manuale

### 7.3 Gestione Asset

**Immagini:**
- Preview inline nel markdown
- Click per zoom
- Supportati: PNG, JPG, GIF, WebP, SVG

**PDF:**
- Viewer integrato nel browser
- Scroll e zoom

**Audio/Video:**
- Player HTML5 nativi
- Supportati: MP3, WAV, MP4, MOV, AVI

**Altri file:**
- Download con click
- Icone specifiche per tipo

---

## 8. Risoluzione Problemi

### 8.1 Agent non si connette

**Sintomo:**
```
🔌 Connecting to wss://snorkel.vaplayground.cloud/ws...
⏳ Waiting for connection...
```

**Soluzioni:**

1. **Verifica connessione internet:**
   ```bash
   ping snorkel.vaplayground.cloud
   ```

2. **Verifica API_KEY:**
   ```bash
   # Deve essere identica in agent/.env e server/.env
   grep API_KEY /Users/enzo/SVILUPPO/obsidian-sync/agent/.env
   grep API_KEY /Users/enzo/SVILUPPO/obsidian-sync/server/.env
   ```

3. **Verifica SSL:**
   ```bash
   # Test connessione WebSocket
   curl -I https://snorkel.vaplayground.cloud
   ```

4. **Log agent:**
   ```bash
   tail -f /tmp/obsidian-sync.log
   tail -f /tmp/obsidian-sync.err
   ```

### 8.2 File non sincronizzati

**Sintomo:**
- Modifichi file in Obsidian
- Non appare nel browser

**Soluzioni:**

1. **Verifica agent in esecuzione:**
   ```bash
   launchctl list | grep obsidian-sync
   ```

2. **Verifica watcher attivo:**
   ```bash
   # Log dovrebbero mostrare "File changed: /path/to/file"
   tail -f /tmp/obsidian-sync.log | grep "File changed"
   ```

3. **Check hash locale:**
   ```bash
   # Database agent
   sqlite3 ~/.obsidian-sync-state.db "SELECT path, hash FROM files;"
   ```

4. **Riavvia agent:**
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
   launchctl load ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
   ```

### 8.3 Conflitti

**Sintomo:**
- Vedi file `.conflict-` nel vault

**Cosa è successo:**
- Stesso file modificato su Mac e Browser mentre offline
- Sistema ha creato copia di conflitto

**Risoluzione:**
1. Apri entrambi i file (originale + `.conflict-`)
2. Confronta le versioni
3. Scegli quale mantenere
4. Elimina il `.conflict-` dopo la risoluzione

### 8.4 Database Corrotto

**Sintomo:**
```
Error: database disk image is malformed
```

**Soluzione:**
```bash
# Backup database corrotto
cp ~/.obsidian-sync-state.db ~/.obsidian-sync-state.db.corrupted

# Riavvia agent - creerà nuovo database vuoto
# Al primo sync verrà ricostruito dal server
launchctl unload ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
launchctl load ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
```

### 8.5 File Ignorati

**Sintomo:**
- Alcuni file non vengono sincronizzati

**Motivi comuni:**
1. **Estensione non whitelist:** controlla [file-validator.js](server/src/middleware/file-validator.js)
2. **File troppo grande:** MAX_FILE_SIZE_MB = 100
3. **Pattern ignorato:** `.obsidian/`, `.trash/`, temp files
4. **Path con caratteri strani:** evita `\0`, `..`

**Soluzioni:**
- Rinomina file con estensione supportata
- Sposta file fuori da `.obsidian/`
- Comprimi file grandi (>100MB) in zip

---

## 9. Backup e Restore

### 9.1 Backup Server (VPS)

**Automatico (Docker Volume):**
```bash
# Backup volume vault
docker run --rm \
  -v obssyncro_vault_data:/data:ro \
  -v $(pwd)/backups:/backup \
  alpine \
  tar czf /backup/vault-$(date +%Y%m%d-%H%M).tar.gz /data
```

**Database:**
```bash
# Via SSH sul VPS
ssh user@snorkel.vaplayground.cloud

# Backup database
cp /data/state.db /data/backups/state-$(date +%Y%m%d-%H%M).db
```

### 9.2 Backup Agent (Mac)

**Database locale:**
```bash
# Backup stato agent
cp ~/.obsidian-sync-state.db ~/Documents/backup-state.db
```

**Vault Obsidian:**
- Il vault è già la tua fonte di verità
- Fai backup come fai normalmente per i tuoi documenti

### 9.3 Restore

**Da backup vault server:**
```bash
# Stop container
docker compose down

# Estrai backup
tar xzf backups/vault-20260421-1030.tar.gz -C /tmp/

# Ripristina
cp -r /tmp/data/* /data/

# Riavvia
docker compose up -d
```

**Da backup agent:**
```bash
# Stop agent
launchctl unload ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist

# Ripristina database
cp ~/Documents/backup-state.db ~/.obsidian-sync-state.db

# Riavvia
launchctl load ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
```

---

## 10. FAQ

### D1: Posso sincronizzare più vault?

**R:** Sì! Basta aggiungerli come sottocartelle di `/Users/enzo/OBS_Lavoro/`:
```
/Users/enzo/OBS_Lavoro/
├── Lavoro/          ← Vault 1
├── Personale/       ← Vault 2
└── Progetti/        ← Vault 3
```
Ogni vault appare come cartella nella Web UI.

### D2: Quanto bandwidth consuma?

**R:** Dipende dall'attività:
- **Idle:** ~0.5 KB/min (ping/pong keepalive)
- **Modifica nota media:** ~5 KB (solo il file modificato)
- **Immagine (1MB):** ~1.3 MB (base64 encoding overhead)
- **Sync iniziale:** Dipende dalla dimensione vault (una tantum)

### D3: È sicuro?

**R:** Sì, multi-livello:
1. **TLS 1.3** per tutte le connessioni (WSS + HTTPS)
2. **API Key** per agent (256-bit hex)
3. **JWT** per Web UI (15min access + 7gg refresh)
4. **httpOnly cookies** anti-XSS
5. **Path traversal protection**
6. **Rate limiting** anti-brute-force

### D4: Cosa succede se offline?

**Agent (Mac):**
- Continua a monitorare file
- Accoda modifiche in memoria
- Riconnette automaticamente con exponential backoff
- Sync quando torna online

**Web UI:**
- Mostra banner "Disconnesso"
- Editor diventa read-only
- Puoi leggere ma non modificare
- Riconnessione automatica

### D5: Posso usare senza Web UI?

**R:** Sì! L'agent funziona autonomamente:
- Monitora il vault
- Sincronizza con il server
- Puoi usare solo Obsidian locale
- Server funge da backup cloud

Web UI è opzionale per accesso remoto.

### D6: Come aggiorno il sistema?

**Server:**
```bash
# Su VPS
cd /opt/obssyncro
git pull
docker compose build
docker compose up -d
```

**Agent:**
```bash
cd /Users/enzo/SVILUPPO/obsidian-sync
git pull
npm install
launchctl unload ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
launchctl load ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
```

### D7: Quanto spazio disco serve?

**Server VPS:**
- Vault: quanto occupano le tue note
- Database: ~50-100MB per 10.000 file
- Trash: fino al 30% del vault (configurabile)
- **Consigliato:** Minimo 2GB liberi per growing

**Mac:**
- Agent: ~5MB (codice + dipendenze)
- Database locale: ~10-50MB (solo metadati)
- Vault: i tuoi file (già presenti)

### D8: Posso disabilitare l'autostart?

**R:** Sì:
```bash
# Disabilita (non si avvia al login)
launchctl unload -w ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist

# Riabilita
launchctl load -w ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
```

### D9: Come cambio password?

**R:** Solo Web UI usa password (Agent usa API Key):

1. Genera nuovo hash:
   ```bash
   node -e "const bcrypt = require('bcrypt'); bcrypt.hash('NUOVA_PASSWORD', 12).then(h => console.log(h))"
   ```

2. Aggiorna `server/.env`:
   ```bash
   ADMIN_PASSWORD_HASH=<nuovo_hash>
   ```

3. Riavvia server in Dokploy (Click "Redeploy")

### D10: Performances con molti file?

**R:** Testato con:
- ✅ 10.000 file (~50MB database)
- ✅ 1.000.000 file (non testato, probabile lenta inizializzazione)

**Ottimizzazioni:**
- SQLite WAL mode per concorrenza
- Indici su path, mtime, timestamp
- Batch sync (max 10 file per volta)
- Debounce 500ms watcher

---

## Supporto

Per problemi o domande:

- **GitHub Issues:** https://github.com/enzoamabile/obssyncro/issues
- **Email:** enzoamabile@gmail.com
- **Documentazione:** [piano-obsidian-sync.md](piano-obsidian-sync.md)

---

**Versione Manuale:** 1.0
**Ultimo Aggiornamento:** 21 Aprile 2026
**Progetto:** Obsidian Sync Bidirezionale v1.0
