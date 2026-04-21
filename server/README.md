# Obsidian Sync Server

Server WebSocket + HTTP per sincronizzazione bidirezionale Obsidian con Web UI.

## Quick Start (Docker Compose)

```bash
# 1. Configura environment variables
cp .env.example .env
# Edita .env con i tuoi valori

# 2. Build e avvia
docker compose up -d

# 3. Verifica stato
docker compose ps
docker compose logs -f
```

## Deploy con Dokploy

Segui questi passaggi in Dokploy:

1. **Crea nuova applicazione**
2. **Configura:**
   - **Repository:** `https://github.com/enzoamabile/obssyncro.git`
   - **Branch:** `main`
   - **Build Command:** `cd server && docker compose build`
   - **Start Command:** `cd server && docker compose up -d`
   - **Port:** `3000`
   - **Domain:** `snorkel.vaplayground.cloud`

3. **Environment Variables** (in Dokploy):
   ```
   NODE_ENV=production
   API_KEY=<your_api_key>
   JWT_SECRET=<your_jwt_secret>
   ADMIN_EMAIL=enzoamabile@gmail.com
   ADMIN_PASSWORD_HASH=<your_bcrypt_hash>
   ```

4. **Deploy**
   - Click "Deploy"
   - Dokploy clonerà, buildarerà e avvierà il container

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment | `production` |
| `PORT` | Server port | `3000` |
| `VAULT_ROOT` | Vault directory | `/data/vault` |
| `TRASH_PATH` | Trash directory | `/data/trash` |
| `DB_PATH` | Database path | `/data/state.db` |
| `MAX_FILE_SIZE_MB` | Max file size | `100` |
| `API_KEY` | Agent API key | *(required)* |
| `JWT_SECRET` | JWT secret | *(required)* |
| `ADMIN_EMAIL` | Admin email | *(required)* |
| `ADMIN_PASSWORD_HASH` | Admin password hash | *(required)* |

## Generazione Password Hash

```bash
node -e "const bcrypt = require('bcrypt'); bcrypt.hash('TUA_PASSWORD', 12).then(h => console.log(h))"
```

## API Endpoints

### Health
- `GET /health` - Server health check

### Authentication
- `POST /auth/login` - Login (returns JWT)
- `POST /auth/refresh` - Refresh token

### WebSocket
- `WS /ws` - WebSocket endpoint (richiede API Key)

### Files
- `GET /api/files/*` - Get file
- `POST /api/files/*` - Create/update file
- `DELETE /api/files/*` - Delete file (soft delete)
- `GET /api/list` - List all files

### Search
- `GET /api/search?q=query` - Full-text search

## Development

```bash
# Install dependencies
npm install
cd client && npm install

# Development server (con proxy WebSocket)
npm run dev

# Build client
npm run client:build

# Production server
npm start
```

## Docker Commands

```bash
# Build immagine
docker build -t obsidian-sync .

# Run container
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/data \
  -e API_KEY=your_key \
  -e JWT_SECRET=your_secret \
  obsidian-sync

# View logs
docker compose logs -f

# Stop container
docker compose down
```

## Troubleshooting

### Container non parte
```bash
# Check logs
docker compose logs

# Check environment variables
docker compose config

# Restart
docker compose restart
```

### Database connection error
```bash
# Enter container
docker compose exec obsidian-sync sh

# Check database
ls -la /data/
```

### WebSocket non si connette
1. Verifica API_KEY uguale su server e agent
2. Controlla firewall/rule su porta 3000
3. Verifica SSL/TLS configuration

## Volumes

I dati sono persistenti nel volume Docker `vault_data`:
- `/data/vault/` - File sincronizzati
- `/data/trash/` - Cestino (soft delete)
- `/data/state.db` - Database SQLite

## Backup

```bash
# Backup volume
docker run --rm \
  -v obsidian-sync_vault_data:/data:ro \
  -v $(pwd)/backups:/backup \
  alpine \
  tar czf /backup/vault-$(date +%Y%m%d).tar.gz /data

# Restore
docker run --rm \
  -v obsidian-sync_vault_data:/data \
  -v $(pwd)/backups:/backup \
  alpine \
  tar xzf /backup/vault-YYYYMMDD.tar.gz -C /
```

## License

MIT
