# UTR Sports MCP Server

A local MCP server that connects Claude Desktop to the UTR Sports platform, giving you natural-language access to your son's match history, tournament registrations, ratings, and opponent data.

---

## Tools Exposed to Claude

| Tool | What it does |
|---|---|
| `search_player` | Find a UTR player by name, returns their ID |
| `get_player_profile` | Full profile: singles/doubles UTR, rating status, upcoming events |
| `get_match_history` | Complete match history with opponent names, decimal UTR ratings, scores, event names, and round info (QF, R16, etc.) |
| `get_upcoming_events` | Tournaments currently registered for, with dates and location |
| `get_event_details` | Full draw and results for a specific tournament |
| `get_player_stats` | Aggregate win/loss record, win %, average opponent UTR, peak opponent UTR |

---

## Setup

### 1. Install dependencies

```bash
cd utr-mcp
npm install
```

### 2. Get your JWT token

The UTR Sports site uses a JWT cookie for authentication.

1. Open **https://app.universaltennis.com** and log in
2. Open DevTools (`F12` or `Cmd+Option+I`)
3. Go to **Application → Cookies → https://app.universaltennis.com**
4. Find the cookie named **`jwt`** and copy its value

> **Note:** JWTs expire periodically. If the server stops returning data, repeat this step to get a fresh token.

### 3. Get your son's Player ID

1. Go to his profile on **https://app.universaltennis.com**
2. The URL will look like: `https://app.universaltennis.com/profiles/1234567`
3. The number at the end (`1234567`) is his Player ID

Alternatively, once the server is running, ask Claude: *"Search for [son's name] on UTR"*

### 4. Configure Claude Desktop

Edit your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following inside the `"mcpServers"` block:

```json
{
  "mcpServers": {
    "utr-sports": {
      "command": "node",
      "args": ["/FULL/PATH/TO/utr-mcp/index.js"],
      "env": {
        "UTR_JWT": "paste-your-jwt-token-here",
        "UTR_PLAYER_ID": "your-sons-player-id"
      }
    }
  }
}
```

> Replace `/FULL/PATH/TO/utr-mcp/` with the actual path where you placed this folder.  
> On macOS this might be `/Users/yourname/utr-mcp/index.js`

### 5. Restart Claude Desktop

Quit and relaunch Claude Desktop. You should see the UTR tools available.

---

## Example Prompts

Once configured, try these in Claude Desktop:

- *"Show me [son's name]'s match history from the last 6 months"*
- *"What tournaments is he signed up for?"*
- *"How has his UTR changed this year?"*
- *"Who were his toughest opponents this season?"*
- *"Get the details for his last tournament"*
- *"Search for [opponent name] on UTR and get their profile"*

---

## Troubleshooting

**"UTR_JWT environment variable is required"**  
→ Check your `claude_desktop_config.json` — make sure `UTR_JWT` is set in the `env` block.

**401 / Unauthorized errors**  
→ Your JWT has expired. Re-extract it from your browser session (Step 2).

**Empty results / 404 errors**  
→ Double-check the Player ID. Try `search_player` to find the correct ID.

**Server not appearing in Claude Desktop**  
→ Verify the file path in `args` is absolute (starts with `/`). Restart Claude Desktop fully.

---

## Refreshing Your JWT

JWTs typically last a few days to a few weeks. When yours expires:

1. Log back into UTR Sports in your browser
2. Re-copy the `jwt` cookie value
3. Update `claude_desktop_config.json` with the new value
4. Restart Claude Desktop

---

## Privacy Note

Your JWT token gives full read access to the UTR account. Keep your `claude_desktop_config.json` private and never commit it to a public repository.
