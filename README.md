# FTL Prints Skills

Claude Code skills for Fort Lauderdale Screen Printing operations.

## Setup

### 1. Install Claude Code

Download and install from [code.claude.com](https://code.claude.com).

### 2. Set Up the GHL MCP Server

Add the GoHighLevel MCP server to your global config at `~/.claude/mcp.json`. If the file doesn't exist, create it.

Add this entry inside the `"mcpServers"` object:

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
