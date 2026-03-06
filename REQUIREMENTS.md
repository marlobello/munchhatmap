# Discord Geo‑Pin Map Bot – Requirements Document

Use this as a high‑level spec for GitHub Copilot (and for yourself) to implement the solution. When something is ambiguous, Copilot should **ask for direction instead of guessing**.

---

## 1. Project overview

**Goal:**  
Build a Discord bot that, when a specific tag is used with an image upload, will:

- Extract geolocation from the image (EXIF) or message context.
- Store a pin (lat/lng + metadata) in a database.
- Expose a web map (Google Maps) that shows all pins.
- Clicking a pin shows the associated image and basic info.
- Start with a **public map**, with a clear path to later restrict access to **Discord server members only**.

**Constraints:**

- Minimal hosting/infrastructure.
- All cloud resources in **Azure**.
- Infrastructure created in a **secure but not over‑engineered** way.
- When in doubt, Copilot should **prompt the user** for decisions.

---

## 2. High‑level architecture

**Components:**

1. **Discord Bot Backend**
   - Language: **TypeScript (Node.js)** (preferred; ask if user wants Python instead).
   - Runs as **Azure Functions** (HTTP‑triggered for interactions/webhooks).
   - Handles:
     - Discord interactions (slash commands, message events if needed).
     - Image download from Discord CDN.
     - EXIF extraction and optional text‑based geocoding.
     - Writing pin data to database.

2. **Map Frontend**
   - Simple **static web app** (HTML + JS, optionally React).
   - Hosted on **Azure Static Web Apps**.
   - Uses **Google Maps JavaScript API**.
   - Calls a backend API to fetch pins as JSON.
   - Initially **public** (no auth).

3. **Data Storage**
   - **Azure Cosmos DB (serverless)** or **Azure Table Storage** for pin records.
   - Optional: **Azure Blob Storage** for long‑term image storage (otherwise use Discord CDN URLs).

4. **Future Auth Layer (Phase 2 – not implemented yet)**
   - Discord OAuth2 login.
   - Membership check for a specific guild.
   - Protect pin API endpoints.
   - Copilot should structure code so this can be added later without major refactor.

---

## 3. Azure infrastructure requirements

Copilot should generate **IaC** (Bicep or Terraform; ask which is preferred) to provision:

1. **Resource Group**
   - Name: ask user for naming convention (e.g., `rg-discord-geo-map-<env>`).
   - Location: ask user (e.g., `eastus`).

2. **Azure Functions**
   - Plan: **Consumption plan** (serverless).
   - Runtime: **Node.js LTS**.
   - App settings:
     - `DISCORD_PUBLIC_KEY`
     - `DISCORD_BOT_TOKEN`
     - `DISCORD_APPLICATION_ID`
     - `GOOGLE_MAPS_API_KEY`
     - `GEOCODING_API_KEY` (if used)
     - `COSMOS_DB_CONNECTION_STRING` (or equivalent)
     - Optional: `BLOB_STORAGE_CONNECTION_STRING`
   - Secure settings via **Key Vault** or Function App application settings (Copilot should ask which approach to use).

3. **Azure Static Web Apps**
   - Hosts the map frontend.
   - Connected to GitHub repo for CI/CD (Copilot should scaffold GitHub Actions).

4. **Database**
   - **Option A (default):** Cosmos DB (serverless, Core/SQL API).
   - **Option B:** Azure Table Storage (cheaper, simpler).
   - Copilot should **ask which option to use**.
   - Data model (see section 5).

5. **Optional: Azure Blob Storage**
   - For storing images if not relying on Discord CDN.
   - Private container with SAS or backend‑proxied access (Copilot should ask which).

6. **Security basics**
   - No public keys/tokens in source control.
   - Restrict CORS on API endpoints to the Static Web App origin (once known).
   - Use least‑privilege for managed identities and connection strings.

---

## 4. Discord application and bot requirements

Copilot should generate setup instructions and minimal helper scripts where useful.

1. **Discord Application Setup**
   - Create an application in Discord Developer Portal.
   - Add a **Bot** user.
   - Enable **Privileged Gateway Intents** if needed:
     - `MESSAGE CONTENT INTENT` (only if reading raw message content; ask user if they want to rely on slash commands instead).
   - Configure **Interactions endpoint URL** to point to Azure Function HTTP trigger.

2. **Bot Permissions**
   - Required permissions (scopes/permissions in OAuth2 URL):
     - `bot`
     - `applications.commands`
   - Bot permissions:
     - View Channels
     - Read Message History
     - Send Messages
     - Use Application Commands
   - No Administrator permission for the bot itself.

3. **Invite URL**
   - Copilot should generate a helper script or README snippet to construct the OAuth2 URL using:
     - `DISCORD_APPLICATION_ID`
     - Required scopes and permissions.

---

## 5. Data model

Copilot should define a shared TypeScript interface for pin records, used by both backend and frontend.

```ts
export interface MapPin {
  id: string;              // UUID
  guildId: string;         // Discord server ID
  channelId: string;       // Channel where it was posted
  messageId: string;       // Original message ID
  userId: string;          // Discord user ID
  lat: number;
  lng: number;
  imageUrl: string;        // Discord CDN URL or Blob URL
  createdAt: string;       // ISO timestamp
  caption?: string;        // Optional message text
  tagUsed?: string;        // e.g., "#mapme"
}
```

Copilot should:

- Create a Cosmos DB container or table with `id` as primary key.
- Consider partition key (e.g., `/guildId` or `/channelId`) and **ask user** which dimension they expect to scale on.

---

## 6. Bot behavior requirements

### 6.1 Triggering logic

- **Primary trigger:** a specific tag in the message, e.g. `#mapme`.
- Message must include **at least one image attachment**.
- Copilot should:
  - Make the tag configurable via environment variable (e.g., `MAP_TRIGGER_TAG`).
  - Ask whether to support **slash command** alternative (e.g., `/pin`) from the start.

### 6.2 Flow when a tagged image is posted

1. Detect message with:
   - Matching tag in content.
   - At least one image attachment (JPEG/PNG).

2. Download the first image from Discord CDN.

3. Extract EXIF GPS data:
   - Use a Node EXIF library (e.g., `exifr`).
   - If GPS present:
     - Convert to decimal lat/lng.

4. If no EXIF GPS:
   - Optional: attempt text‑based geocoding.
   - Copilot should **ask**:
     - Do we use Google Geocoding API or another provider?
     - What text to send (full message, subset, etc.)?
   - If geocoding fails, respond in Discord with a friendly message (e.g., “No location data found”).

5. Create a `MapPin` record and store it in the database.

6. Respond in Discord:
   - Confirm pin creation.
   - Optionally include a link to the map.

### 6.3 Error handling

- If image download fails → log and reply with a short error message.
- If EXIF parsing fails → log and fall back to geocoding (if enabled).
- If database write fails → log and reply with a generic error.
- All secrets and errors should **not** be exposed to users.

---

## 7. Map frontend requirements

### 7.1 Basic behavior (Phase 1 – public)

- Single page app (SPA or simple HTML+JS).
- On load:
  - Initialize Google Map.
  - Fetch pins from `/api/getPins` (Azure Function).
  - Render markers for each pin.

### 7.2 Marker behavior

- Each marker:
  - Shows an info window on click.
  - Info window content:
    - Image (thumbnail or full width).
    - Username or user ID (Copilot should ask if we want to resolve IDs to usernames via a backend call).
    - Timestamp.
    - Link to original Discord message (constructed from guild/channel/message IDs).

### 7.3 API contract

- `GET /api/getPins`
  - Returns `MapPin[]` as JSON.
  - Initially public (no auth).
  - Designed so that later it can check authentication/session.

- Optional filters (future):
  - By guild, channel, date range, user, etc.
  - Copilot should design the handler to accept query params but only implement minimal behavior now.

---

## 8. Security and configuration requirements

- **Secrets**:
  - Never hard‑code tokens or API keys.
  - Use environment variables / app settings.
  - Optionally integrate with **Azure Key Vault** (Copilot should ask if desired).

- **CORS**:
  - For `/api/getPins`, initially allow `*` during development.
  - For production, restrict to the Static Web App origin (Copilot should add a TODO and ask for the final domain).

- **Logging & monitoring**:
  - Use Application Insights for Functions (if enabled; ask user).
  - Log:
    - Errors (without sensitive data).
    - Basic metrics (number of pins created, failures, etc.).

- **Permissions**:
  - Bot requests only minimal permissions.
  - Azure resources use least‑privilege identities where possible.

---

## 9. Developer experience requirements

Copilot should:

1. **Ask for these choices early:**
   - Language: TypeScript/Node vs Python.
   - IaC tool: Bicep vs Terraform vs ARM (default to Bicep if no preference).
   - Database: Cosmos DB vs Table Storage.
   - Use of Blob Storage vs Discord CDN only.
   - Use of geocoding fallback or EXIF‑only first.
   - Use of Application Insights.

2. **Generate:**
   - A `README.md` with:
     - Setup steps for Discord application.
     - How to configure Azure resources.
     - How to run locally (Functions + frontend).
   - Example `.env.example` file with all required environment variables.
   - GitHub Actions workflow for:
     - Deploying Azure Functions.
     - Deploying Static Web App.
     - (Optionally) deploying IaC.

3. **Structure the repo** (suggested):

```text
/infra
  main.bicep (or terraform files)
/backend
  src/
    index.ts
    handlers/
      discordInteractions.ts
      getPins.ts
      exif.ts
      geocoding.ts
      db.ts
  package.json
/frontend
  src/
    index.html
    main.tsx or main.js
    map.ts
  package.json
README.md
.env.example
```

Copilot should **not** assume frameworks (React, Vite, etc.) without asking.

---

## 10. Future phase: Discord‑members‑only map (for later)

Copilot should design with this in mind but **not implement yet**:

- Add Discord OAuth2 login.
- Store session tokens (e.g., signed JWT or server‑side session).
- Add `/api/login` and `/api/logout`.
- Modify `/api/getPins` to require a valid session and guild membership.

---

## 11. Explicit prompts Copilot should ask the user

When generating code/infra, Copilot should explicitly ask:

1. **Language choice:**  
   “Do you want the backend in TypeScript/Node.js or Python?”

2. **IaC choice:**  
   “Should I use Bicep, Terraform, or another tool for Azure infrastructure?”

3. **Database choice:**  
   “Do you prefer Cosmos DB (more flexible) or Azure Table Storage (simpler/cheaper) for storing pins?”

4. **Image storage:**  
   “Should we rely on Discord CDN URLs only, or also upload images to Azure Blob Storage?”

5. **Geocoding fallback:**  
   “If EXIF GPS is missing, should I implement text‑based geocoding now, and which provider (e.g., Google Geocoding)?”

6. **Frontend stack:**  
   “Do you want a plain HTML/JS frontend or a framework like React (e.g., Vite + React)?”

7. **Monitoring:**  
   “Should I enable Application Insights for Azure Functions?”

8. **Auth phase timing:**  
   “Do you want me to scaffold the future Discord OAuth2 auth endpoints now (without enforcing them), or leave that for later?”

---

If you want, next step I can turn this into a concrete repo layout with starter files and comments tailored to your chosen stack (Node vs Python, Cosmos vs Table, etc.).
