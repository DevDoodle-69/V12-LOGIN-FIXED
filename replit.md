# replit.md

## Overview

This is a **Facebook Messenger chatbot** built on Node.js, commonly referred to as "V12-FCA" (Facebook Chat API). It uses an unofficial Facebook Chat API (a custom fork located in the `V12-FCA/` directory) to authenticate via cookies/appstate and interact with Facebook Messenger — listening for messages, handling commands, and performing various Messenger actions (send messages, change group settings, manage threads, etc.).

The bot authenticates using saved Facebook session cookies (appstate), connects via MQTT for real-time message listening, and processes incoming messages through a command handler system with a configurable prefix.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Project Structure

- **`index.js`** — Main entry point. Bootstraps authentication, initializes the API, sets up event/command handlers, and starts the bot.
- **`V12-FCA/`** — The custom Facebook Chat API library (unofficial). This is a forked/modified version of facebook-chat-api. It handles:
  - Login and session management (`V12-FCA/index.js`)
  - MQTT-based real-time message listening (`V12-FCA/src/listenMqtt.js`)
  - All Messenger API actions as individual modules in `V12-FCA/src/` (sendMessage, getThreadInfo, getUserInfo, etc.)
  - HTTP request utilities and cookie management (`V12-FCA/utils.js`)
- **`core_settings/config.json`** — Bot configuration: prefix, owner UIDs, admin UIDs, login credentials, logging level, retry settings.
- **`helpers/auth.js`** — Authentication helper that reads Facebook appstate from files (`v12-account.txt`, `appstate.json`, etc.) and initiates login through the FCA library.
- **`helpers/index.js`** — Utility helpers (e.g., `getStreamFromURL`).
- **`system_core/`** — Core bot infrastructure:
  - `logger.js` — Custom logging with chalk styling and ASCII art branding
  - `controllers/commandHandler.js` — Command routing and execution
  - `handle/eventHandler.js` — Event routing
  - `database/index.js` — Database connection layer
- **`features/events/`** — Event handlers (e.g., `message.js` for incoming messages)

### Authentication Flow

1. Bot reads Facebook session cookies (appstate) from files: `v12-account.txt`, `v12-account-v2.txt`, or `appstate.json`
2. Falls back to email/password login if no valid appstate found
3. The FCA library handles session management, cookie persistence, and reconnection
4. MQTT connection is established for real-time message streaming

### Messaging Architecture

- **Protocol**: MQTT over WebSocket for real-time message listening (not HTTP polling)
- **Pattern**: The FCA library exposes an `api` object with methods for all Messenger operations
- **Command Processing**: Messages are received via MQTT → routed through EventHandler → parsed by CommandHandler using the configured prefix (`^` by default)
- **Self-Listen**: Configured to listen to its own messages (`selfListen: true`)

### Database

- The project includes dependencies for multiple database solutions: MongoDB/Mongoose, SQLite3, Sequelize, quick.db, Prisma, and ioredis
- Database connection is initialized via `system_core/database/index.js`
- The actual database choice isn't fully clear from the available files, but multiple options are available

### Key Design Decisions

- **Custom FCA Fork**: Rather than using a published npm package, the Facebook Chat API is bundled directly in `V12-FCA/`. This allows deep customization of the login flow, MQTT handling, and API methods.
- **Cookie-based Auth**: Uses saved Facebook session cookies instead of official API tokens, since Facebook doesn't provide an official chat bot API for personal accounts.
- **Modular API Methods**: Each Messenger action (sendMessage, getThreadInfo, etc.) is a separate module in `V12-FCA/src/`, following a factory pattern that receives `defaultFuncs`, `api`, and `ctx`.
- **Retry Logic**: Built-in retry mechanism (`retryRequest.js`) with exponential backoff for network errors.

## External Dependencies

### Core Runtime
- **Node.js** >= 16.0.0
- **Express** — HTTP server (likely for health checks or webhooks)

### Facebook Integration
- **Custom FCA Library** (`V12-FCA/`) — Unofficial Facebook Chat API using MQTT, HTTP requests, and cookie-based auth
- **MQTT** (`mqtt` package) — Real-time message transport via Facebook's MQTT broker
- **websocket-stream** — WebSocket transport for MQTT
- **Puppeteer** — Browser automation for screenshots and scraping

### AI/ML
- **@google/genai** and **@google/generative-ai** — Google Gemini AI integration

### Database Options
- **MongoDB** via `mongoose` / `mongodb`
- **SQLite3** via `sqlite3` / `sequelize`
- **quick.db** — Simple key-value storage
- **Prisma** (`@prisma/client`) — ORM
- **ioredis** — Redis client

### Media Processing
- **sharp** / **jimp** / **canvas** — Image processing
- **fluent-ffmpeg** / **@ffmpeg-installer/ffmpeg** — Video/audio processing

### Utilities
- **axios** / **node-fetch** / **request** — HTTP clients
- **cheerio** / **jsdom** — HTML parsing
- **chalk** / **gradient-string** — Terminal styling
- **dotenv** — Environment variable management
- **moment-timezone** — Date/time handling
- **socket.io** — WebSocket server

### Authentication Files
- `v12-account.txt` — Facebook session cookies (fbstate) in JSON format
- `persistent-device.json` — Device identity for consistent login sessions