# 🎩 MunchHat Map

A Discord bot that pins geo-tagged MunchHat photos on a live map. Post a photo with `#munchhat` or `#munchhatchronicles` and it appears on the map.

## Architecture

| Component | Azure Service | Cost |
|---|---|---|
| Discord bot (persistent Gateway) | Azure Container Apps (Consumption) | ~$10–15/month |
| Map API (`/api/getPins`) | Azure Functions (Consumption) | Free tier |
| Map frontend (Leaflet + OpenStreetMap) | Azure Static Web Apps (Free) | Free |
| Database | Azure Cosmos DB (Free tier) | Free |
| Secrets | Azure Key Vault (Standard) | ~$0.03/month |

**Total estimated cost: ~$10–15/month** (driven by Container Apps for the persistent bot connection).

---

## Repository Layout

```
.
├── .github/workflows/      GitHub Actions CI/CD
├── infra/                  Bicep infrastructure-as-code
│   └── modules/
├── bot/                    Discord Gateway bot (Node.js / TypeScript)
│   ├── src/
│   └── Dockerfile
├── api/                    Azure Functions API (TypeScript)
│   └── src/
├── frontend/               Static map page (HTML + vanilla JS)
├── .env.example            Environment variable template
└── README.md
```

---

## Setup

### 1. Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Name it **MunchHat Map**.
3. **Bot** tab → **Add Bot** → copy the **Token** (= `DISCORD_BOT_TOKEN`).
4. Enable the following **Privileged Gateway Intents**:
   - ✅ **MESSAGE CONTENT INTENT** (required for reading `#munchhat` tags)
5. **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `View Channels`, `Read Message History`, `Send Messages`
   - Copy the generated URL and invite the bot to your server.

### 2. Azure Infrastructure

**Prerequisites:** Azure CLI, Bicep CLI, an Azure subscription.

```bash
# Login
az login

# Create resource group
az group create --name rg-munchhatmap-prod --location eastus

# Deploy all infrastructure
az deployment group create \
  --resource-group rg-munchhatmap-prod \
  --template-file infra/main.bicep \
  --parameters repositoryUrl=https://github.com/YOUR_ORG/munchhatmap
```

> ⚠️ **Cosmos DB free tier**: Only one free-tier Cosmos DB account is allowed per Azure subscription.
> If you already have one, remove `enableFreeTier: true` from `infra/modules/cosmosdb.bicep`.

### 4. Add Secrets to Key Vault

After the infrastructure is deployed, add secrets to the Key Vault:

```bash
KV=munchhatmap-kv-prod  # adjust if you changed the env param

az keyvault secret set --vault-name $KV --name discord-bot-token   --value "YOUR_BOT_TOKEN"
az keyvault secret set --vault-name $KV --name cosmos-db-endpoint  --value "https://munchhatmap-cosmos-prod.documents.azure.com:443/"
az keyvault secret set --vault-name $KV --name cosmos-db-key       --value "YOUR_COSMOS_PRIMARY_KEY"
```

### 5. GitHub Actions Secrets

Add the following secrets to your GitHub repository (**Settings → Secrets → Actions**):

| Secret | Description |
|---|---|
| `AZURE_CLIENT_ID` | Service principal / app registration client ID |
| `AZURE_TENANT_ID` | Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_STATIC_WEB_APPS_API_TOKEN` | Output from Bicep deployment: `staticWebAppDeploymentToken` |

**Federated credential setup** (for the OIDC `azure/login` action):

```bash
az ad sp create-for-rbac \
  --name "munchhatmap-github-actions" \
  --role Contributor \
  --scopes /subscriptions/YOUR_SUBSCRIPTION_ID/resourceGroups/rg-munchhatmap-prod \
  --sdk-auth
```

### 6. Update the Map URL in Container App

After the Static Web App is deployed, update the `MAP_URL` environment variable:

```bash
az containerapp update \
  --name munchhatmap-bot-prod \
  --resource-group rg-munchhatmap-prod \
  --set-env-vars MAP_URL=https://YOUR_STATIC_WEB_APP_HOSTNAME.azurestaticapps.net
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

### API (Azure Functions)

```bash
# Requires Azure Functions Core Tools: npm install -g azure-functions-core-tools@4
cd api
cp local.settings.json.example local.settings.json   # fill in values
npm install
npm run build
npm start
```

The API will be available at `http://localhost:7071/api/getPins`.

### Frontend

Open `frontend/index.html` directly in a browser, or serve it with any static server:

```bash
cd frontend
npx serve .
```

> For local development, set `window.API_BASE = 'http://localhost:7071/api'` in the browser console or use a proxy.

---

## Bot Behavior

1. A user posts a message containing `#munchhat` or `#munchhatchronicles` **with at least one image attached**.
2. The bot downloads the first attached image and attempts to read GPS coordinates from its EXIF data.
3. If no EXIF GPS is found, the bot strips the trigger tag from the message text and attempts [Nominatim](https://nominatim.openstreetmap.org/) geocoding (free, no API key required).
4. If a location is found, a `MapPin` record is saved to Cosmos DB and the bot replies with a confirmation.
5. If no location can be determined, the bot replies with a friendly message.

---

## Data Model

```ts
interface MapPin {
  id: string;         // UUID
  guildId: string;    // Discord server ID (Cosmos DB partition key)
  channelId: string;
  messageId: string;
  userId: string;     // Discord user ID
  lat: number;
  lng: number;
  imageUrl: string;   // Discord CDN URL
  createdAt: string;  // ISO 8601
  caption?: string;
  tagUsed?: string;   // "#munchhat" or "#munchhatchronicles"
}
```

---

## Phase 2: Discord-Members-Only Map

The API already includes placeholder endpoints for future authentication:

- `GET /api/auth/login` — initiates Discord OAuth2 flow (501 stub)
- `GET /api/auth/callback` — handles OAuth2 callback (501 stub)
- `GET /api/auth/logout` — clears session (501 stub)

When Phase 2 is implemented, `/api/getPins` will validate a session token and check guild membership before returning data.
