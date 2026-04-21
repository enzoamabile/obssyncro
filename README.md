# Obsidian Sync Bidirezionale

Sistema di sincronizzazione **bidirezionale in tempo reale** tra il vault Obsidian locale e una Web UI cloud ospitata su VPS.

## Architettura

```
[Obsidian Vault locale]
        │  chokidar (file events)
        ▼
[Agent Node.js Mac]  ──── WSS (TLS 1.3) ────►  [Sync Server Node.js + Express]
  launchd autostart                                      │
  SQLite WAL locale                              SQLite WAL + Docker Volume
                                                         │
                                               [Web UI Svelte 5 + CodeMirror 6]
                                                         │
                                                    [Browser]
```

## Stack Tecnologico

| Componente | Tecnologia |
|------------|-----------|
| File watching | `chokidar` |
| Trasporto | WebSocket (`ws`) |
| Database | `better-sqlite3` (WAL mode) |
| Web UI | Svelte 5 + CodeMirror 6 |
| Auth | JWT + bcrypt |
| Container | Docker + Dokploy |

## Quick Start

### Prerequisiti

- Node.js 20+
- macOS (per l'agent)
- VPS con Dokploy (per il server)

### Setup Agent Mac

1. Installa le dipendenze:
   ```bash
   cd agent
   npm install
   ```

2. Configura l'ambiente:
   ```bash
   cp .env.example .env
   # Edit .env con i valori corretti
   ```

3. Avvia l'agent:
   ```bash
   npm start
   ```

4. Configura launchd per autostart:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.enzo.obsidian-sync.plist
   ```

### Setup Server VPS

1. Installa le dipendenze:
   ```bash
   cd server
   npm install
   cd client && npm install && npm run build
   ```

2. Configura l'ambiente:
   ```bash
   cp .env.example .env
   # Genera segreti: openssl rand -hex 32
   # Genera password hash: node -e "require('bcrypt').hash('password',12,(_,h)=>console.log(h))"
   ```

3. Avvia con Docker:
   ```bash
   docker compose up -d
   ```

4. Configura su Dokploy:
   - Domain: `snorkel.vaplayground.cloud`
   - Port: `3000`
   - SSL: Let's Encrypt (auto)

## Struttura Repository

```
obsidian-sync/
├── agent/              # Daemon Mac
│   ├── src/
│   │   ├── index.js           # Entry point
│   │   ├── watcher.js         # chokidar file watching
│   │   ├── sync-client.js     # WebSocket client
│   │   ├── file-handler.js    # File I/O + hashing
│   │   ├── state-store.js     # SQLite locale
│   │   └── conflict-resolver.js
│   └── .env
│
└── server/             # VPS server + Web UI
    ├── src/
    │   ├── index.js           # Express bootstrap
    │   ├── ws-hub.js          # WebSocket hub
    │   ├── sync-handler.js    # Sync logic
    │   ├── file-store.js      # File I/O
    │   └── state-db.js        # SQLite server
    ├── client/                # Svelte 5 UI
    │   └── src/
    │       ├── App.svelte
    │       ├── components/
    │       └── stores/
    └── docker-compose.yml
```

## Funzionalità

- ✅ Sync bidirezionale real-time (< 1s latenza)
- ✅ Tutti i tipi di asset (md, img, pdf, audio, video, zip)
- ✅ Conflict resolution (Last Write Wins + copy)
- ✅ Soft delete con cestino 30 giorni
- ✅ Full-text search client-side
- ✅ Web UI con editor CodeMirror 6

## Documentazione Completa

Vedi [`piano-obsidian-sync.md`](../piano-obsidian-sync.md) per dettagli architetturali completi.

## Licenza

MIT

---

**Autore:** Enzo Amabile <enzoamabile@gmail.com>
