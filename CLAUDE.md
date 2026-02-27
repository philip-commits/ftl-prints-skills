# CLAUDE.md

This repo contains Claude Code skills for Fort Lauderdale Screen Printing (FTL Prints) operations.

## Structure

Each skill lives in `.claude/skills/` with its own folder and `SKILL.md` file:

```
.claude/skills/<skill-name>/
  SKILL.md    — The skill definition (YAML frontmatter + markdown)
```

## Available Skills

- `.claude/skills/ghl/` — Daily pipeline briefing via GoHighLevel CRM
- `.claude/skills/ghl-activity/` — Daily CRM activity summary (messages, notes, tasks, stage changes)

## Dependencies

- **GoHighLevel MCP server** (`ghl`) must be configured in `~/.claude/mcp.json` — see README.md for setup.
