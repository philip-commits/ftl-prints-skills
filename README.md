# FTL Prints Skills

Claude Code skills for Fort Lauderdale Screen Printing operations.

## Setup

### 1. Install Claude Code

Download and install from [code.claude.com](https://code.claude.com).

### 2. Set Up GHL Authentication (OAuth2 — Recommended)

OAuth2 tokens auto-refresh every 24 hours. After one-time setup, no manual token rotation is needed.

**Prerequisites:**
1. Register a GHL Marketplace app at https://marketplace.gohighlevel.com
2. Set redirect URI to `http://localhost:9876/callback`
3. Enable scopes: conversations, opportunities, contacts (read+write)

**Run the setup:**

```bash
python3 .claude/skills/ghl/assets/ghl_oauth_setup.py <client_id> <client_secret>
```

Click "Allow" in the browser window that opens. Tokens are saved to `~/.config/ftl-prints/ghl_tokens.json` and auto-refresh forever.

### 2b. GHL MCP Server (Optional — Best-Effort)

The MCP server provides Claude Code tool access to GHL. It uses a PIT token which requires manual rotation. The system falls back to direct API calls with OAuth2 when MCP returns 401.

Add to `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "ghl": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://services.leadconnectorhq.com/mcp/",
        "--header",
        "Authorization:${GHL_AUTH}",
        "--header",
        "locationId:${GHL_LOCATION}",
        "--transport",
        "http-only"
      ],
      "env": {
        "GHL_AUTH": "Bearer <YOUR_PIT_TOKEN_HERE>",
        "GHL_LOCATION": "<YOUR_LOCATION_ID_HERE>"
      }
    }
  }
}
```

Replace:
- `<YOUR_PIT_TOKEN_HERE>` with your GHL Private Integration Token (Settings > Private Integrations)
- `<YOUR_LOCATION_ID_HERE>` with your GHL Location ID

### 3. Register the MCP Server in Your Project

**This step is critical.** Claude Code caches MCP server lists per-project. After adding the GHL config to `~/.claude/mcp.json`, you need to register it for each project where you want to use it.

Run this from within your project directory:

```bash
claude mcp add ghl
```

Or manually add the `ghl` entry to the `mcpServers` key in `~/.claude.json` under the relevant project key.

Without this step, the GHL MCP will **not** appear in `/mcp` even though the config is correct.

### 4. Clone the Skills Repo

```bash
git clone https://github.com/philip-commits/ftl-prints-skills.git ~/.claude/skills/ftl-prints-skills
```

### 5. Run It

Open Claude Code in your project directory and type:

```
/morning-report
```

### 6. Update

To get the latest skills:

```bash
cd ~/.claude/skills/ftl-prints-skills && git pull
```

## Available Skills

| Skill | Trigger | Description |
|-------|---------|-------------|
| Morning Report | `/morning-report` | Daily pipeline briefing with CRM actions |
