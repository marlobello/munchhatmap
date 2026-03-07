# MunchHat Map

![MunchHat Map](munchhat.png)

A Discord bot that drops a hat pin on a live map every time someone posts a photo with `#munchhat` or `#munchhatchronicles`. Browse the map at **[munchhatmap.dotheneedful.dev](https://munchhatmap.dotheneedful.dev)**.

---

## How It Works

1. Post a photo in Discord with `#munchhat` or `#munchhatchronicles`.
2. The bot reads the location from your message text first (e.g. *"Spring, Texas"*); if there is none, it falls back to GPS EXIF data embedded in the photo.
3. A hat pin is dropped on the map at that location with your photo, username, and a link back to the original message.
4. Use `/munchhat-import` to retroactively import all existing posts from a channel.

---

## Architecture

| Component | Azure Service | Estimated Cost |
|---|---|---|
| Discord bot (persistent Gateway) | Azure Container Apps (Consumption) | ~$10–15/month |
| Map API | Azure Functions (Consumption) | Free tier |
| Map frontend (Leaflet + OpenStreetMap) | Azure Static Web Apps (Free) | Free |
| Database | Azure Cosmos DB (Free tier) | Free |
| Secrets | Azure Key Vault (Standard) | ~$0.03/month |

**Total estimated cost: ~$10–15/month** (driven by Container Apps for the persistent Discord Gateway connection).

---

## Repository Layout

```
.
├── .github/workflows/
│   ├── deploy-bot.yml          Build & push Docker image → Container App (SHA-tagged)
│   ├── deploy-api.yml          Build & deploy Azure Functions
│   ├── deploy-frontend.yml     Deploy static site to Azure Static Web Apps
│   └── deploy-infrastructure.yml  Bicep IaC deployment
├── infra/                      Bicep infrastructure-as-code
│   └── modules/
├── bot/                        Discord Gateway bot (Node.js / TypeScript)
│   ├── src/
│   │   ├── handlers/
│   │   │   ├── pinProcessor.ts   Core pin logic (location extraction, geocoding)
│   │   │   ├── messageHandler.ts Live message handler
│   │   │   ├── importHandler.ts  /munchhat-import slash command
│   │   │   ├── geocoding.ts      Nominatim geocoding + reverse geocoding
│   │   │   ├── exif.ts           GPS EXIF extraction
│   │   │   └── db.ts             Cosmos DB writes
│   │   └── types/mapPin.ts
│   └── Dockerfile
├── api/                        Azure Functions API (TypeScript)
│   └── src/functions/
│       ├── getPins.ts            GET /api/getPins
│       └── getStats.ts           GET /api/getStats
├── frontend/                   Static map page (HTML + vanilla JS + Leaflet)
│   ├── index.html
│   ├── munchhat.png            Hat logo (favicon, header, map markers)
│   └── js/
│       ├── main.js
│       ├── map.js              Leaflet map + markercluster rendering
│       └── stats.js            Stats panel (leaderboard, states, countries)
├── munchhat.png                Brand logo
├── .env.example
└── README.md
```

---

## Setup

### 1. Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Name it **MunchHat Map**.
3. **Bot** tab → **Add Bot** → copy the **Token** (= `DISCORD_BOT_TOKEN`).
4. Enable **Privileged Gateway Intents**:
   - ✅ **MESSAGE CONTENT INTENT** (required to read `#munchhat` tags)
5. **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `View Channels`, `Read Message History`, `Send Messages`
   - Copy the generated URL and invite the bot to your server.

### 2. Azure Infrastructure

**Prerequisites:** Azure CLI, Bicep CLI, an Azure subscription.

```bash
az login

az group create --name rg-munchhatmap-prod --location centralus

az deployment group create \
  --resource-group rg-munchhatmap-prod \
  --template-file infra/main.bicep \
  --parameters repositoryUrl=https://github.com/YOUR_ORG/munchhatmap
```

> ⚠️ **Cosmos DB free tier**: Only one free-tier Cosmos DB account is allowed per Azure subscription.
> Remove `enableFreeTier: true` from `infra/modules/cosmosdb.bicep` if you already have one.

### 3. Add Secrets to Key Vault

```bash
KV=munchhatmap-kv-prod

az keyvault secret set --vault-name $KV --name discord-bot-token   --value "YOUR_BOT_TOKEN"
az keyvault secret set --vault-name $KV --name cosmos-db-endpoint  --value "https://YOUR_COSMOS_ACCOUNT.documents.azure.com:443/"
az keyvault secret set --vault-name $KV --name cosmos-db-key       --value "YOUR_COSMOS_PRIMARY_KEY"
```

### 4. GitHub Actions Secrets

Add the following to **Settings → Secrets and variables → Actions**:

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | App registration client ID (OIDC) |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Output from Bicep: `staticWebAppDeploymentToken` |

**Federated credential setup** (OIDC — no long-lived secret needed):

```bash
az ad app create --display-name "munchhatmap-github-actions"
# Then add a federated credential for repo:YOUR_ORG/munchhatmap / branch:main
# and assign Contributor + AcrPush roles on the resource group
```

### 5. Custom Domain (optional)

The live deployment uses `munchhatmap.dotheneedful.dev`. To use your own domain:

1. Add a CNAME record pointing to the Static Web App's default hostname.
2. Add it in the Azure portal under **Custom domains**, or update `staticWebAppCustomDomain` in `infra/main.bicep`.
3. Update the `MAP_URL` environment variable on the Container App:

```bash
az containerapp update \
  --name munchhatmap-bot-prod \
  --resource-group rg-munchhatmap-prod \
  --set-env-vars MAP_URL=https://your-domain.example.com
```

---

## Local Development

### Bot

```bash
cd bot
cp ../.env.example .env   # fill in DISCORD_BOT_TOKEN, COSMOS_DB_ENDPOINT, COSMOS_DB_KEY
npm install
npm run dev
```

### API

```bash
# Requires Azure Functions Core Tools v4
npm install -g azure-functions-core-tools@4

cd api
cp local.settings.json.example local.settings.json
npm install
npm run build
npm start
```

API available at `http://localhost:7071/api/getPins` and `http://localhost:7071/api/getStats`.

### Frontend

```bash
cd frontend
npx serve .
```

Set `window.API_BASE = 'http://localhost:7071/api'` in the browser console to point at the local Functions host.

---

## Bot Behavior

### Live messages
When a message is posted with `#munchhat` or `#munchhatchronicles` and at least one image:

1. **Location extraction** — the bot strips the trigger tag and intelligently extracts a place name from the message text (handles *"in Spring, Texas"*, *"Great tacos in Austin, TX! 🌮"*, etc.).
2. **Geocoding** — the extracted text is geocoded via [Nominatim](https://nominatim.openstreetmap.org/) (free, no API key). GPS EXIF data is used as a fallback if no text location is found.
3. **Best-match selection** — when Nominatim returns multiple results, the closest match to the queried place name is chosen (avoids e.g. *"Big Spring"* when *"Spring"* was intended).
4. A `MapPin` is saved to Cosmos DB and the bot replies with a confirmation and a link to the map.

### `/munchhat-import` slash command
Scans the full history of the current channel and imports all qualifying posts, skipping any already in the database (deduplication by message ID). Registers instantly per guild on bot startup.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/getPins` | Returns all `MapPin` records as JSON |
| `GET` | `/api/getStats` | Returns leaderboard, US states, and countries aggregated from all pins |

---

## Data Model

```ts
interface MapPin {
  id: string;          // UUID
  guildId: string;     // Discord server ID (Cosmos DB partition key)
  channelId: string;
  messageId: string;
  userId: string;      // Discord user ID
  username?: string;   // Discord username at time of posting
  lat: number;
  lng: number;
  imageUrl: string;    // Discord CDN URL
  createdAt: string;   // ISO 8601
  caption?: string;    // Full message text
  tagUsed?: string;    // "#munchhat" or "#munchhatchronicles"
  country?: string;    // Country name
  state?: string;      // US state (populated for US pins only)
}
```

---

## Frontend Features

- **Interactive map** — Leaflet + OpenStreetMap, no API key required
- **Hat pin markers** — custom MunchHat logo used as the map marker
- **Marker clustering** — nearby pins group into a numbered badge; exact same-location pins spiderfy on click
- **Photo popups** — each pin shows the photo, username, date, and a link back to the Discord message
- **Stats panel** (📊 button) — leaderboard by user, breakdown by US state and country

---

## Phase 2: Discord-Members-Only Map

Stub endpoints exist for a future auth gate:

- `GET /api/auth/login` — initiates Discord OAuth2 flow
- `GET /api/auth/callback` — handles OAuth2 callback
- `GET /api/auth/logout` — clears session

When implemented, `/api/getPins` will validate a session and verify guild membership before returning data.

