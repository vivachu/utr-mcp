# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-file MCP (Model Context Protocol) server (`index.js`) that exposes UTR Sports tennis data to Claude Desktop. It authenticates via a JWT cookie extracted from the UTR Sports browser session and wraps two APIs:

- `api.utrsports.net` (v4) — decimal-precision UTR ratings, match overviews
- `app.universaltennis.com` (v1/v2) — player search, event details

## Commands

```bash
npm install       # install dependencies
npm start         # run the server (requires UTR_JWT env var)
```

To run manually with environment variables:
```bash
UTR_JWT=your-token UTR_PLAYER_ID=1234567 node index.js
```

The server communicates via stdio (MCP standard), so it's not a web server — it's launched by Claude Desktop as a subprocess.

## Architecture

Everything lives in `index.js` (ES module, `"type": "module"`):

- **`utrFetch(base, path, params)`** — single fetch wrapper; attaches Bearer JWT, throws on non-2xx
- **`v4(path, params)`** / **`v1(path, params)`** — shortcuts for the two API bases
- **`fmtUtr/fmtPlayer/fmtDate/fmtScore`** — pure formatting helpers for response text
- **`extractSelf(results, pid)`** — finds the target player's own object within a results array (the v4 `/overview` endpoint returns all players in each match row)
- **6 MCP tools** registered on a `McpServer` instance, each returning `{ content: [{ type: "text", text: "..." }] }`

All tools share a common pattern: resolve `player_id` (parameter → `DEFAULT_PLAYER_ID` env var → error), call one or both APIs, format results as markdown text.

## Key API Behavior

The v4 `/v4/player/{id}/overview` endpoint is the workhorse — it returns:
- `results[]` — all past matches with `isWinner`, decimal UTRs on player objects, scores, event names
- `upcomingEvents.tmsEvents[]` — registered tournaments

The `score` field in results can be either a string or an object keyed by set number (`"0"`, `"1"`, …), each with `winner`, `loser`, and optional `tiebreak`.

## Configuration

Deployed via Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "utr-sports": {
      "command": "node",
      "args": ["/absolute/path/to/utr-mcp/index.js"],
      "env": {
        "UTR_JWT": "jwt-token-from-browser",
        "UTR_PLAYER_ID": "numeric-player-id"
      }
    }
  }
}
```

JWT tokens expire after days–weeks; refresh by re-extracting the `jwt` cookie from the UTR Sports site (Application → Cookies in DevTools).

## Planned: USTA Integration (v2)

See cole-tennis-mcp-v2-briefing.md for full spec.

### New env vars
- USTA_BEARER — JWT Bearer token (expires daily, refresh via /oauth/token)
- USTA_REFRESH_TOKEN — long-lived refresh token for silent renewal
- USTA_PARENT_UAID — 2019010659
- USTA_CHILD_UAID — 2019010660 (Cole)

### New tools
- get_usta_schedule — Cole's registered tournaments
- get_usta_rankings — USTA section ranking points  
- search_usta_tournaments — upcoming tournaments NOT yet registered (deduped)
- get_tournament_field — UTR event field analysis
- add_tournament_to_calendar — Google Calendar + Gmail integration

## Planned: USTA Tournament Search Refactor (v3)

See usta-tournament-search-api.md for full spec.

### Refactor these methods based off new spec
- search_usta_tournaments — upcoming tournaments NOT yet registered (deduped)