# Say — Voice Notes for Obsidian

Record a voice memo, get a structured note. Say uses OpenAI Whisper to transcribe your audio and Claude to turn the transcript into a clean, organized Obsidian note — with a summary, key points, tasks, and tags.

> **Desktop only.** Requires microphone access and API keys for OpenAI and Anthropic.

---

## How it works

1. Click the mic icon in the ribbon (or run **Record voice note** from the command palette)
2. Speak — a live waveform shows the mic is active
3. Click **Stop & Process**
4. The transcript is sent to Whisper, then to Claude
5. The result is inserted at your cursor in the active note

---

## Output format

Each recording produces a structured markdown block:

```markdown
# Title of the note

## Summary
2–4 sentence summary of key points, decisions, and named entities.

## Key Points
- Point one
- Point two

## Tasks
- [ ] Action item extracted from speech
- [ ] Another task

## Transcript
> [!note]- Full Transcript
> The raw transcription text...

## Tags
#person/name #place/city #topic/label
```

---

## Setup

### 1. Install the plugin

Install via Obsidian's Community Plugins browser, or manually copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/voice-notes-ai/`.

### 2. Add your API keys

Go to **Settings → Say** and enter:

- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)
- **OpenAI API key** — get one at [platform.openai.com](https://platform.openai.com)

---

## Settings

| Setting | Description |
|---|---|
| Anthropic API Key | Used to call Claude for summarization |
| OpenAI API Key | Used to call Whisper for transcription |
| Model | Choose Claude Opus (most capable), Sonnet (fast & smart), or Haiku (fastest) |
| Custom Instructions | The full prompt sent to Claude — edit to change the output format entirely |
| Extract tags | Toggle the `## Tags` section on or off |
| Include full transcript | Toggle the `## Transcript` callout on or off |

### Custom Instructions

The **Custom Instructions** field is the complete system prompt sent to Claude. The default prompt produces the structured format shown above. You can replace it entirely to change the output — for example to use a different language, different sections, or a completely different structure.

---

## Privacy

- Audio is sent to **OpenAI** (Whisper) for transcription
- The transcript is sent to **Anthropic** (Claude) for summarization
- Your API keys are stored locally in your vault at `.obsidian/plugins/voice-notes-ai/data.json`
- No data is sent to any other service, and nothing is logged or tracked

---

## Requirements

- Obsidian v0.15.0 or later
- Desktop only (uses the Web Audio API and MediaRecorder)
- An active OpenAI API key (for Whisper transcription)
- An active Anthropic API key (for Claude summarization)

---

## License

MIT
