# MunchHat Map

![MunchHat Map](munchhat.png)

A Discord bot that drops a hat pin on a live map every time someone posts a photo with `#munchhat` or `#munchhatchronicles`. Browse the map at **[munchhatmap.dotheneedful.dev](https://munchhatmap.dotheneedful.dev)**.

---

## How It Works

1. Post a photo in Discord with `#munchhat` or `#munchhatchronicles`.
2. The bot determines the location using a three-step pipeline (see [Geocoding](#geocoding) below).
3. A hat pin is dropped on the map at that location with your photo, username, and a link back to the original message.
4. Use `/munchhat-import` to retroactively import all existing posts from a channel.

---

## Architecture

| Component | Azure Service | Estimated Cost |
|---|---|---|
| Discord bot (persistent Gateway) | Azure Container Apps (Consumption) | ~$10–15/month |
| Geocoding & image recognition | Azure OpenAI (gpt-4o-mini, Standard) | Pay-per-token (~$0/month at low volume) |
| Map API | Azure Functions (Consumption) | Free tier |
| Map frontend (Leaflet + OpenStreetMap) | Azure Static Web Apps (Free) | Free |
| Database | Azure Cosmos DB (Free tier) | Free |
| Secrets | Azure Key Vault (Standard) | ~$0.03/month |

**Total estimated cost: ~$10–15/month** (driven by Container Apps for the persistent Discord Gateway connection).

---

## Geocoding

Location is resolved in three steps, in order:

1. **GPS EXIF** — if the attached photo has embedded GPS coordinates, they are extracted directly and reverse-geocoded to country/state via Azure OpenAI.
2. **Text geocoding** — if no EXIF data is found, the message text (minus the trigger tag, capped at 300 characters) is sent to Azure OpenAI (`gpt-4o-mini`) with a structured prompt asking for precise coordinates, place name, country, and US state. The model attempts to return the most specific location it can — a named landmark, restaurant, or neighborhood rather than just a city.
3. **Vision geocoding** — if text geocoding returns no result, the attached photo is sent to Azure OpenAI with image recognition enabled (`detail: low`) and the model attempts to identify the location from visual cues.

If none of the three steps resolve a location, the message is reported as unmapped in the import summary or bot reply.

All geocoding calls return `{lat, lng, country, state, place_name}` in a single API call. `state` is only populated for US locations.

---

## Repository Layout

```
.
├── .github/workflows/
│   ├── deploy-bot.yml          Build & push Docker image → Container App (SHA-tagged, npm audit)
│   ├── deploy-api.yml          Build & deploy Azure Functions (npm audit)
│   ├── deploy-frontend.yml     Deploy static site to Azure Static Web Apps
│   └── deploy-infrastructure.yml  Bicep IaC deployment
├── infra/                      Bicep infrastructure-as-code
│   └── modules/
│       ├── openai.bicep        Azure OpenAI resource + gpt-4o-mini deployment
│       └── ...
├── bot/                        Discord Gateway bot (Node.js / TypeScript)
│   ├── src/
│   │   ├── handlers/
│   │   │   ├── aoai.ts           Azure OpenAI geocoding (text, vision, reverse)
│   │   │   ├── pinProcessor.ts   Three-step geocoding pipeline
│   │   │   ├── messageHandler.ts Live message handler
│   │   │   ├── importHandler.ts  /munchhat-import slash command
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
│       ├── config.js           Runtime config (API base URL)
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
az keyvault secret set --vault-name $KV --name aoai-endpoint       --value "https://YOUR_AOAI_RESOURCE.openai.azure.com/"
az keyvault secret set --vault-name $KV --name aoai-key            --value "YOUR_AOAI_KEY"
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
cp ../.env.example .env   # fill in DISCORD_BOT_TOKEN, COSMOS_DB_*, AZURE_OPENAI_*
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

Update `js/config.js` to set `window.API_BASE = 'http://localhost:7071/api'` for local development.

---

## Bot Behavior

### Live messages
When a message is posted with `#munchhat` or `#munchhatchronicles` and at least one image:

1. The three-step geocoding pipeline runs (EXIF → text → vision — see [Geocoding](#geocoding)).
2. A `MapPin` is saved to Cosmos DB with the resolved coordinates, country, and state.
3. The bot replies with a confirmation and a link to the map.

If no location can be determined, the bot replies with guidance on how to fix the post.

### `/munchhat-import` slash command
Scans the history of a channel and imports all qualifying posts, skipping any already in the database (deduplication by message ID). Also scans a thread named **Munch Map** if one exists — all images in that thread are treated as candidates regardless of tags. Registers on bot startup per guild.

**Access:**
- **Admins / MOD role** — imports all messages in the channel
- **Everyone else** — imports only their own messages

A **5-minute cooldown** applies per user per channel to prevent quota exhaustion.

#### Parameters

| Parameter | Type | Description |
|---|---|---|
| `lookback` | string | How far back to scan. Accepts a number + unit: `30m`, `6h`, `7d`, `2w`, `3M`, `1y`. Cannot be used with `message`. |
| `verbosity` | choice | Controls output detail. See table below. Default: `verbose`. |
| `message` | string | Full Discord message URL to import a single specific post. Cannot be used with `lookback` or `channel`. |
| `channel` | channel | Scan a different channel but post results here (keeps target channel clutter-free). Cannot be used with `message`. |
| `force-location` | string | Location string sent directly to AOAI, bypassing all geocoding. Only valid with `message`. Overwrites the pin if it already exists. |

#### Verbosity levels

| Level | Output |
|---|---|
| `standard` | Counts only: *✅ 3 pinned · ⏭️ 12 already mapped · ⚠️ 2 need attention* |
| `verbose` | Counts + jump links to every message that couldn't be mapped (default) |
| `debug` | Everything in verbose, plus for each failed message: the exact text sent to AOAI, the raw AOAI JSON response for each geocoding step, and which steps were attempted |

#### Mutual exclusivity rules

- `force-location` requires `message`
- `message` and `lookback` cannot be combined
- `message` and `channel` cannot be combined (the message URL already encodes the channel)

#### Example usages

```
# Quick weekly catch-up — counts only
/munchhat-import lookback:7d verbosity:standard

# Scan #munchhat from a mod channel, show failures with jump links
/munchhat-import channel:#munchhat lookback:30d verbosity:verbose

# Debug why a specific post failed geocoding
/munchhat-import message:https://discord.com/channels/734.../1480... verbosity:debug

# Force a location for a post with no useful text (e.g. a photo-only post)
/munchhat-import message:https://discord.com/channels/734.../1480... force-location:Eiffel Tower, Paris France
```

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
  country?: string;    // English country name
  state?: string;      // US state name (US pins only)
  place_name?: string; // Descriptive name of the specific location
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

