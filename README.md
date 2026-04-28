# Harper Agent Skills

This repository provides specialized "skills" for AI agents (like Cursor, Windsurf, or Junie) to build better applications on [Harper](https://harper.fast/).

## Installation

### GH Skills

Make sure you have the GitHub CLI installed, then you can `skill add` and `skill update` these skills:
```
brew install gh
gh skill add harperfast/skills
gh skill update
```

### NPX Skills 
Add these skills to your local project using the [skills](https://skills.sh/) CLI:

```bash
npx skills add harperfast/skills
```

Re-run this command later if you want to get the latest updates from us.

### Manual Installation

If your corporate network prevents the `skills` CLI from downloading the skills, you can install them manually:

1.  Download the repository as a ZIP file from [GitHub](https://github.com/HarperFast/skills) (Code > Download ZIP).
2.  Extract the contents of the ZIP file.
3.  Copy the skill folders (e.g., `harper-best-practices`) into your project's agent configuration directory:
    *   **Junie, Cursor, Windsurf:** `.agent/skills`
    *   **Claude Desktop:** `.claude/skills`
    *   **Other Agents:** Refer to your agent's documentation for its skills/rules directory.

## Available Skills

### [Harper Best Practices](harper-best-practices/SKILL.md)

Comprehensive guidelines for building, extending, and deploying Harper applications. Covers:

- Schema design and relationships.
- Automatic REST and WebSocket APIs.
- Custom resources and table extensions.
- Advanced features like Vector Indexing and Caching.

## How it Works

These skills are structured to be easily consumed by Large Language Models (LLMs) and AI agents. For a technical overview of how agents use these files, see [AGENTS.md](AGENTS.md).
