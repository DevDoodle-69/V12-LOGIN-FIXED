# V12 FCA Bot - Project Documentation

## Overview
V12 FCA is a Node.js-based Facebook Messenger chatbot using a custom Facebook Chat API (V12-FCA) implementation. The bot supports command-based interactions, event listening, database persistence, and media processing.

## Quick Start

### Running the Bot
```bash
./.run
```

The `.run` script performs the following operations:
- Installs dependencies if not present
- Checks for v12-account.txt credentials file
- Starts the bot with full logging output

Alternative startup commands:
```bash
npm start      # Standard production startup
npm run dev    # Development mode with auto-reload (requires nodemon)
```

## Credentials and Authentication

### v12-account.txt Integration
The bot uses v12-account.txt as the primary credential source. This file contains Facebook session cookies in the following structure:

```json
{
  "metadata": {
    "extractor": "NZ R Ultimate Cookie Extractor",
    "version": "3.0.0",
    "timestamp": "2026-03-11T17:18:34.706Z",
    "sessionId": "nzr_19cdde84cd7_b8881bb3"
  },
  "fbstate": [
    {
      "id": "nzr_0000",
      "key": "sb",
      "value": "cookie_value",
      "domain": "facebook.com",
      "path": "/",
      "secure": true,
      "httpOnly": true
    }
  ],
  "security": {
    "extracted_at": "2026-03-11T17:18:34.706Z"
  }
}
```

### Authentication Flow
1. `helpers/auth.js` loads v12-account.txt and extracts the fbstate cookie array
2. Cookies are passed to V12-FCA/index.js for Facebook authentication
3. Upon successful login, the bot automatically refreshes and persists credentials
4. Session state is maintained for subsequent restarts

### Credential Priority
The bot attempts authentication in the following order:
1. v12-account.txt (cookie-based session - fastest)
2. v12-account-v2.txt (backup cookie session)
3. Email/Password from core_settings/config.json (fallback method)

## Project Structure

```
├── .run                          Executable startup script
├── index.js                      Main bot entry point and event loop
├── V12-FCA/                      Facebook Chat API implementation
│   ├── index.js                  FCA login system and core API
│   └── src/                      API utility modules
├── helpers/
│   └── auth.js                   v12-account.txt loading and credential management
├── features/
│   ├── commands/                 Individual command implementations
│   └── events/                   Event handler modules (messages, reactions)
├── system_core/
│   ├── controllers/              CommandHandler for routing and execution
│   ├── database/                 MongoDB/database connection layer
│   └── handle/                   EventHandler for system-wide event processing
├── core_settings/
│   └── config.json               Centralized bot configuration
├── replit.md                     This documentation file
└── package.json                  Project dependencies and scripts
```

## Configuration

The bot reads configuration from `core_settings/config.json`. Key settings:

```json
{
  "bot": {
    "prefix": "^",
    "listenEvents": false,
    "selfListen": true,
    "forceLogin": true,
    "botName": "V12",
    "ownerName": "NZ R",
    "ownerUid": ["facebook_user_id"],
    "adminUids": ["admin_user_ids"],
    "login": {
      "username": "email@example.com",
      "password": "password"
    }
  },
  "logging": {
    "level": "info"
  },
  "retries": {
    "maxRetries": 3,
    "retryDelay": 5000
  },
  "language": "en"
}
```

## Core Dependencies

| Package | Purpose |
|---------|---------|
| V12-FCA | Custom Facebook Chat API implementation |
| axios | HTTP client for API requests |
| express | Web server framework |
| mongoose | MongoDB object mapper |
| puppeteer | Browser automation |
| fluent-ffmpeg | Media file processing |
| @google/generative-ai | Google AI integration |
| socket.io | WebSocket communication |

## Key Features

- Facebook Messenger integration with session persistence
- Command-based bot system with configurable prefix
- Real-time event listening and reaction handling
- MongoDB database for user and conversation storage
- Media processing and attachment support
- AI integration (Google Generative AI)
- MQTT support for distributed messaging
- Automatic session refresh and cookie management

## Troubleshooting

### Authentication Failures

**Problem: Bot fails to authenticate**
- Verify v12-account.txt exists in the project root
- Confirm the fbstate array contains valid Facebook cookies
- Check that core_settings/config.json has correct email and password
- Ensure system time is synchronized (affects cookie validity)

**Problem: Credentials expire**
- Facebook session cookies expire after 90 days
- Extract fresh cookies from Facebook using the NZ R Ultimate Cookie Extractor
- Update v12-account.txt with new fbstate array
- Alternatively, rely on email/password login defined in config.json

### Runtime Issues

**Problem: Dependencies not installed**
- Execute ./.run script which auto-installs packages
- Manually run: npm install

**Problem: Database connection failures**
- Verify MongoDB connection string in system_core/database/index.js
- Ensure database service is running and accessible
- Check network connectivity to database host

**Problem: Port conflicts**
- Verify no other services are using port 3000 (default)
- Modify express server configuration if needed

## Development

Standard npm scripts:

```bash
npm start      Start bot in production mode
npm run dev    Start with nodemon auto-reload
npm run lint   Run ESLint code quality checks
npm test       Execute Jest test suite
```

## Logging

The bot uses the winston/npmlog logging system with the following levels:
- info: Standard operational messages
- warn: Warning conditions
- error: Error conditions requiring attention

All logs are prefixed with timestamps and severity levels for production tracking.

## Deployment Considerations

- Store sensitive credentials in environment variables in production
- Use v12-account.txt for session management
- Implement proper error handling for API rate limits
- Monitor database performance under load
- Maintain separate logging for production environments
