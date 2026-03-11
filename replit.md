# V12 FCA Bot - Project Documentation

## Overview
V12 FCA is a Node.js-based Facebook Messenger chatbot using a custom Facebook Chat API (V12-FCA) implementation.

## Quick Start

### Running the Bot
```bash
./.run
```

The `.run` script automatically:
- Installs dependencies if needed
- Checks for v12-account.txt credentials
- Starts the bot with proper logging

Alternatively:
```bash
npm start      # Normal start
npm run dev    # Development mode with auto-reload (requires nodemon)
```

## Credentials & Authentication

### v12-account.txt Connection
The bot uses **v12-account.txt** as the primary credential file. This file contains Facebook session cookies in the following format:

```json
{
  "metadata": { /* session metadata */ },
  "fbstate": [ /* array of Facebook cookies */ ],
  "security": { /* security info */ }
}
```

**How it works:**
1. `helpers/auth.js` loads v12-account.txt and extracts the `fbstate` array
2. The extracted cookies are passed to V12-FCA/index.js for authentication
3. The bot automatically refreshes and updates credentials after login

### Priority Login Methods
The bot tries credentials in this order:
1. **v12-account.txt** (cookies - fastest)
2. **v12-account-v2.txt** (backup cookies)
3. **Email/Password** from `core_settings/config.json` (fallback)

## Project Structure

```
├── .run                          # Quick start script
├── index.js                      # Main bot entry point
├── V12-FCA/                      # Facebook Chat API implementation
│   ├── index.js                  # FCA login system
│   └── src/                      # API utilities
├── helpers/
│   └── auth.js                   # v12-account.txt connection logic
├── features/
│   ├── commands/                 # Bot command handlers
│   └── events/                   # Event handlers (messages, reactions)
├── system_core/
│   ├── controllers/              # Command processing
│   ├── database/                 # Database connections
│   └── handle/                   # Event handlers
├── core_settings/
│   └── config.json               # Bot configuration
└── package.json                  # Dependencies
```

## Configuration

Edit `core_settings/config.json`:
```json
{
  "bot": {
    "prefix": "^",
    "botName": "V12",
    "ownerUid": ["your-facebook-uid"],
    "adminUids": ["admin-uids"],
    "login": {
      "username": "your-email@gmail.com",
      "password": "your-password"
    }
  }
}
```

## Dependencies
- **V12-FCA**: Custom Facebook Chat API
- **axios**: HTTP requests
- **express**: Web server
- **mongoose/mongodb**: Database
- **puppeteer**: Browser automation
- **ffmpeg**: Media processing
- **Google Generative AI**: AI features

## Key Features
- ✓ Facebook Messenger integration
- ✓ Command-based bot system
- ✓ Event listening & reactions
- ✓ Database persistence
- ✓ Media processing
- ✓ AI integration

## Troubleshooting

**Bot won't authenticate:**
- Verify `v12-account.txt` is valid and has `fbstate` array
- Check `core_settings/config.json` for correct email/password
- Ensure cookies haven't expired (refresh if older than 90 days)

**Cookies expired:**
- Extract fresh cookies from Facebook and update v12-account.txt
- Or use email/password login from config.json

**Dependencies missing:**
- Run `./.run` which auto-installs dependencies
- Or: `npm install`

## Development
```bash
npm run dev    # Start with auto-reload
npm run lint   # Check code quality
npm test       # Run tests
```
