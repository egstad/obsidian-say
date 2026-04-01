import {
  App,
  Editor,
  MarkdownView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl,
} from "obsidian";
import Anthropic from "@anthropic-ai/sdk";

// ─── Settings ─────────────────────────────────────────────────────────────

// Increment this when DEFAULT_SETTINGS.customInstructions changes so existing
// users who haven't manually edited their prompt get the updated default.
const PROMPT_VERSION = 2;

interface VoiceNotesSettings {
  anthropicApiKey: string;
  openAiApiKey: string;
  customInstructions: string;
  promptVersion: number;
  enableTags: boolean;
  includeTranscript: boolean;
  model: string;
}

const DEFAULT_SETTINGS: VoiceNotesSettings = {
  anthropicApiKey: "",
  openAiApiKey: "",
  promptVersion: PROMPT_VERSION,
  customInstructions:
    "You are a precise transcription analyst. You receive a raw voice memo transcript and return ONLY valid Obsidian-flavored markdown — no preamble, no explanations, nothing outside the structure below.\n\nIf the transcript is empty or unintelligible, return nothing.\n\nReturn the following sections in this exact order:\n\n# [One-line title — 12 words or fewer, plain prose, no punctuation]\n\n## Summary\nWrite 2–4 sentences. Be specific and accurate. Prioritize actions, decisions, and named entities over vague impressions.\n\n## Key Points\n3–7 bullets. Each should stand alone as a meaningful statement. Omit filler.\n\n## Tasks\nExtract every explicit or implied to-do. Treat \"I need to…\", \"I should…\", \"I want to remember…\", \"Let's…\", \"We should…\", \"I'll…\", \"I have to…\" as tasks.\nFormat each as an Obsidian checkbox: - [ ] action-first plain language (e.g. \"- [ ] Email Alex about timeline\", \"- [ ] Schedule vet appointment\").\nIf no tasks exist, omit this section entirely.\n\n## Transcript\n> [!note]- Full Transcript\n> [insert the full original transcript here, preserving line breaks]\n\n## Tags\nOne line of space-separated Obsidian tags. Include people, places, clients, organizations, projects, and topic categories.\nUse nested format: #person/name #place/city #client/name #project/name #topic/label\nLowercase only. Hyphens for spaces within a segment. No label, no bullet — tags only.",
  enableTags: true,
  includeTranscript: true,
  model: "claude-opus-4-6",
};

// ─── Transcription ────────────────────────────────────────────────────────

async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string
): Promise<string> {
  const ext = audioBlob.type.includes("mp4") ? "mp4" : "webm";
  const boundary = "----ObsidianBoundary" + Date.now().toString(16);
  const encoder = new TextEncoder();
  const audioBuffer = await audioBlob.arrayBuffer();

  const preamble = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${audioBlob.type || "audio/webm"}\r\n\r\n`
  );
  const modelPart = encoder.encode(
    `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
  );
  const formatPart = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`
  );
  const epilogue = encoder.encode(`--${boundary}--\r\n`);

  const total =
    preamble.byteLength +
    audioBuffer.byteLength +
    modelPart.byteLength +
    formatPart.byteLength +
    epilogue.byteLength;
  const body = new Uint8Array(total);
  let offset = 0;
  body.set(preamble, offset); offset += preamble.byteLength;
  body.set(new Uint8Array(audioBuffer), offset); offset += audioBuffer.byteLength;
  body.set(modelPart, offset); offset += modelPart.byteLength;
  body.set(formatPart, offset); offset += formatPart.byteLength;
  body.set(epilogue, offset);

  const response = await requestUrl({
    url: "https://api.openai.com/v1/audio/transcriptions",
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: body.buffer,
  });

  if (response.status !== 200) {
    throw new Error(`Transcription failed (${response.status}): ${response.text}`);
  }

  return response.text.trim();
}

// ─── AI Processing ────────────────────────────────────────────────────────

interface AIResult {
  title: string;
  body: string;
}

async function processWithClaude(
  transcript: string,
  settings: VoiceNotesSettings
): Promise<AIResult> {
  const client = new Anthropic({
    apiKey: settings.anthropicApiKey,
    dangerouslyAllowBrowser: true,
  });

  const response = await client.messages.create({
    model: settings.model,
    max_tokens: 2048,
    system: settings.customInstructions,
    messages: [
      {
        role: "user",
        content: transcript,
      },
    ],
  });

  const body =
    response.content[0].type === "text"
      ? response.content[0].text.trim().replace(/\n{3,}/g, "\n\n")
      : "";

  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 100) : "Voice Note";

  return { title, body };
}

// ─── Note Insertion ───────────────────────────────────────────────────────

/** Inserts the processed voice note at the cursor in the active editor. */
function insertIntoCurrentNote(
  result: AIResult,
  settings: VoiceNotesSettings,
  editor: Editor
): void {
  let body = result.body;

  // Strip the transcript callout if the user has disabled it
  if (!settings.includeTranscript) {
    body = body.replace(/\n*^## Transcript[\s\S]*$/m, "").trimEnd();
  }

  editor.replaceSelection("\n\n" + body + "\n\n");
}

// ─── Recording Modal ──────────────────────────────────────────────────────

const SAY_LOGO_PATH =
  "M16.2598 0.0898438C17.2598 0.0898438 18.3102 0.269922 19.6602 0.669922C20.2401 0.849925 20.6498 1.14014 21.0098 1.37012C21.3598 1.60012 21.7702 1.95934 22.2402 2.06934C23.1802 2.29936 23.8801 2.88994 24.5801 3.41992C25.4 4.05984 25.9801 4.41956 26.75 4.76953C27.57 5.17953 28.1504 6.41008 28.1504 7.58008C28.15 8.80983 25.9805 10.1598 25.1104 10.1602C23.8805 10.1602 22.1805 9.51986 21.1904 7.99023C19.9605 6.18032 17.4402 5.93948 16.6201 5.93945C16.3301 5.93945 15.7998 6.11008 15.5098 6.58008C15.2798 7.0499 14.9302 7.46007 14.5703 7.75C13.6903 8.33 13.5204 8.69008 13.1104 9.33008C11.9404 11.2 11 10.4998 10.71 14.4795C10.65 15.3595 10.8901 15.9397 11.1201 16.4697C11.3501 16.9996 11.76 17.2895 12.4697 17.8193C13.3497 18.4593 12.8202 19.1695 13.9902 19.6895C15.9201 20.5094 15.8005 21.0895 18.4404 20.9795C19.6102 20.9196 20.7799 21.2699 21.8896 21.7998C22.6496 22.0898 23.2898 22.8 23.7598 23.79C23.8798 24.2 24.1704 24.5501 24.4004 24.79C24.8102 25.1999 25.0996 25.61 25.0996 26.5996C25.0996 27.0696 25.1003 27.4801 25.2803 27.8301C25.4602 28.3 25.5098 28.8302 25.5098 29.29C25.5097 30.8698 24.8101 32.3896 24.1602 33.8594C23.9802 34.3292 23.6904 34.7995 23.5703 35.3193C23.0403 37.5393 23.1601 38.3598 21.9902 39.2998C21.6402 39.5898 21.35 40.0002 21 40.7002C20.8199 41.1101 20.36 41.5201 20.1201 41.75C19.2402 42.6899 17.6602 42.6298 16.3203 43.5596C15.1503 44.3796 14.5596 43.7397 13.3896 43.9697C12.2799 44.1997 11.1703 44.7293 10.2305 44.7295C8.06047 44.7295 5.42961 43.2093 3.84961 41.5693H3.86035C3.39039 41.0994 2.81023 40.8095 2.28027 40.5195C1.11027 39.8195 0 39.1694 0 37.3594C0.000106343 36.3596 0.410045 35.7796 1.16992 35.5996C1.39992 35.5396 1.87023 35.3095 1.99023 35.1895C2.52011 34.6598 3.10001 34.6094 3.7998 34.6094C5.25973 34.6094 5.97024 35.0196 6.49023 36.1895C6.96023 37.1895 8.00996 37.1902 8.70996 38.4102C9.18004 39.1699 10.2303 39.3496 10.9902 39.3496C12.5702 39.3496 14.2703 39.2894 14.7402 38.9395C15.8501 38.0596 16.8496 37.1796 17.1396 35.8398C17.3696 34.7898 17.9601 35.1995 18.0801 33.4395C18.1403 32.9097 18.8402 32.6796 18.7803 31.7998C18.7203 31.1599 19.3094 30.0401 19.3096 28.9902C19.3096 28.2305 19.1303 27.6401 18.9004 27.29C18.4904 26.7601 18.0801 26.5899 17.3203 26.5898C16.3803 26.5898 13.9798 26.5299 12.3398 25.1299C10.1699 23.3199 9.05976 24.4893 8.00977 22.0293C6.7198 19.0498 4.78972 18.8696 4.84961 14.8301C4.90961 12.4901 4.79039 9.73934 5.90039 8.56934C6.77998 7.62941 7.00998 6.16977 7.88965 5C8.70965 3.89 9.18039 3.82941 9.65039 3.64941C10.0003 3.52948 10.4706 3.41999 10.9404 2.9502C11.4104 2.48023 11.8201 2.07016 12.75 1.49023L13.8604 0.790039C14.6202 0.260146 15.3799 0.089874 16.2598 0.0898438ZM103.729 0C104.729 0 105.9 0.119516 106.36 1.10938C106.94 2.39913 107.41 2.80961 107.41 3.56934C107.41 3.79934 107.35 4.03996 107.18 4.20996C106.48 4.90984 105.48 5.38001 105.07 6.37988C104.54 7.66987 103.26 8.54975 102.67 9.71973C102.44 10.1897 102.09 10.7197 101.68 11.1797C101.27 11.7097 100.74 12.1199 100.51 12.8799C100.39 13.2898 100.16 13.7003 99.5703 13.9902C98.6903 14.4602 98.1702 15.4502 97.7002 16.4502C96.7602 18.5599 95.4796 18.3802 94.8896 20.3701C94.5996 21.3097 94.0102 21.1901 93.7803 21.54C93.2004 22.6499 92.8399 23.6495 91.6104 24.2295C90.8504 24.6395 90.0295 25.23 89.4395 26.04C88.8495 26.7399 88.2096 27.3303 87.5098 27.9102C86.3399 28.8502 85.5796 30.3101 84.6396 31.25C84.2298 31.6599 84.0494 32.1297 83.9395 32.5996C83.7595 33.4196 83.5295 34.1798 82.7695 34.5898C82.4797 34.7698 82.3002 34.9402 82.2402 35.29C82.0602 36.3398 81.24 37.2196 80.3701 37.9795C79.8401 38.3895 79.5497 38.9801 79.4297 39.6201C79.2497 40.4998 78.8997 41.1994 78.0801 41.6094C76.8501 42.1994 77.2596 42.8395 76.5596 43.1895C76.2696 43.3094 75.9696 43.3701 75.6797 43.3701L75.6895 43.3799C74.9297 43.3797 74.1699 42.9698 73.5801 42.5C72.7601 41.86 72.1699 41.0396 72.1699 40.0996C72.17 38.2897 72.9898 35.5899 74.9795 34.1299C76.3895 33.0799 76.6798 33.1897 78.2598 29.9199C78.9597 28.51 80.6599 27.3998 80.54 25.8799C80.36 23.7699 80.9502 23.4195 80.9502 22.0195C80.9501 21.3797 80.4201 21.1995 80.54 19.6797C80.5401 19.4497 80.7198 19.1496 80.4199 17.75C79.9499 15.5801 78.2498 15.47 77.2598 14.4102C76.2098 13.3002 76.6701 12.7094 74.7402 11.4795C74.3903 11.2496 73.7403 11.0099 73.2803 11.0098C71.8803 11.0098 70.4697 10.3093 69.1797 10.0693C67.3699 9.71927 66.4895 8.48987 66.0195 6.79004C65.9596 6.61012 65.9004 6.20013 65.9004 5.91016C65.9004 3.74021 68.0698 3.3295 69.5898 3.68945C70.5898 3.91945 71.4604 4.97949 72.4004 4.97949C74.5698 4.91966 74.39 5.92017 77.1396 6.62012C77.7296 6.80012 78.2503 7.31992 78.7803 7.66992C80.13 8.66996 80.9498 10.7099 82.9395 11.8799C83.4095 12.1699 83.7604 12.6999 84.1104 13.1699C84.6401 13.8697 84.9901 14.6295 85.46 15.2793C86.1 16.0393 86.3398 16.8598 86.3398 17.7998C86.3398 18.5598 86.52 19.9102 86.46 20.4902C87.8098 19.9103 88.1598 19.4899 88.5098 18.79C89.5597 16.9801 91.3199 16.2699 91.96 14.46C92.9 11.83 94.89 10.5399 96.29 7.95996C96.64 7.37999 96.76 7.01991 97.1699 6.66992C99.9799 4.49992 100.04 2.39988 101.74 0.879883C102.5 0.240121 103.14 0.000111711 103.729 0ZM49.3398 4.41016C50.3898 4.41016 51.4504 5.04969 52.1504 5.92969C52.5003 6.39966 52.7897 7.15977 52.9697 8.26953C53.3197 10.3195 53.7903 12.5998 54.3203 14.0098C54.7902 15.1797 54.3206 15.8795 55.0205 17.1094C55.4905 17.8694 55.6602 18.7499 55.6602 19.6299C55.6602 20.6796 56.0697 21.6793 56.1299 22.3193C56.3099 23.4292 56.48 25.3595 56.71 26.4795C56.77 26.7095 56.8301 26.9497 56.8301 27.1797C56.8301 27.8797 56.4805 28.4102 56.4805 28.9902C56.4808 29.3401 56.8896 29.8696 57.0098 30.2793C57.1298 30.7493 57.1904 31.2702 57.1904 31.7402C57.1903 32.4401 56.9004 33.1403 56.9004 33.9102C56.9005 34.38 57.0199 34.8498 57.1299 35.3096C57.2499 35.9496 57.54 37.12 57.54 37.71C57.5399 38.5298 56.9502 39.2898 56.4902 39.7598C56.0802 40.1098 55.6096 40.29 55.1396 40.29C54.6098 40.2899 54.14 40.1093 53.6201 39.8193C51.5104 38.4694 51.3399 36.3699 51.3398 34.0801L51.4004 31.3301C51.4004 30.7502 51.3399 30.1 51.1699 29.75C50.7599 29.75 50.12 29.7496 49.4102 29.8096C48.8802 29.8696 48.4102 29.9297 47.9502 29.9297C46.8402 29.9297 45.6696 29.6995 44.8496 29.2295L44.1504 28.9395C43.9704 29.1694 43.6196 29.5195 43.3896 29.9395C42.8597 30.8794 42.4497 31.7496 42.2197 32.9795C42.0997 33.5595 41.87 33.7999 41.75 33.9199C41.4001 34.3298 41.2197 34.6198 41.2197 34.9697C41.2197 35.1397 41.2199 35.3198 41.3398 35.5498C41.4598 35.7798 41.5205 35.9599 41.5205 36.1299C41.5205 36.4798 41.3399 36.7699 41.1699 37.1299C40.5301 38.2396 40.0602 39.1794 40 39.8193C39.88 40.9292 39.6502 41.5197 38.7705 42.0996C38.2406 42.4496 37.6602 42.6796 37.0703 42.6797H37.0498C36.3499 42.6796 35.6505 42.3893 35.0605 41.8594C34.4205 41.2794 34.0605 40.8597 34.0605 40.2197C34.0606 40.0397 34.1199 39.8093 34.5898 37.9395C35.0599 36.2395 36.81 34.0793 37.46 31.1494C38.5099 26.5299 40.3895 25.6497 40.8496 22.3701C41.1396 20.3801 42.3701 18.9195 42.3701 16.5195C42.3702 15.2297 43.3697 14.0597 43.7197 13.0098C44.0697 11.8398 45.3005 8.73953 45.4805 8.26953C45.8904 7.26981 46.1802 6.6898 47 5.58008C47.6999 4.76015 48.5199 4.41022 49.3398 4.41016ZM48.5303 14.6494C48.1803 15.4694 47.8301 15.8201 47.8301 16.5801C47.83 17.8101 47.1301 19.7401 46.6602 20.79C45.9002 22.5499 45.4297 23.5399 45.4297 24.1299C46.1296 24.5998 47.0699 24.83 48.0098 24.8301C49.3595 24.8301 50.5893 24.5398 50.7598 24.2998C50.6998 23.8298 50.2902 22.6596 50.4102 21.3096L50.4004 21.3193C50.4601 20.4996 49.8704 19.7998 49.9902 19.04C50.2202 17.8101 49.5199 16.5201 49.1699 16C48.9899 15.71 48.7603 15.4694 48.5303 14.6494Z";

type ModalState = "idle" | "recording" | "processing" | "done" | "error";

class RecordingModal extends Modal {
  private settings: VoiceNotesSettings;
  private state: ModalState = "idle";
  private activeEditor: Editor | null = null;

  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private recordingSeconds = 0;

  // Audio visualizer
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animFrameId: number | null = null;

  // UI refs
  private statusEl!: HTMLElement;
  private canvasEl!: HTMLCanvasElement;
  private timerEl!: HTMLElement;
  private buttonContainerEl!: HTMLElement;

  constructor(app: App, settings: VoiceNotesSettings, activeEditor: Editor | null = null) {
    super(app);
    this.settings = settings;
    this.activeEditor = activeEditor;
  }

  onOpen() {
    this.modalEl.addClass("voice-notes-modal");
    const { contentEl } = this;

    const titleEl = contentEl.createEl("h2", { cls: "voice-notes-title" });
    titleEl.setAttribute("aria-label", "Say");
    const svg = titleEl.createSvg("svg", {
      attr: {
        "aria-hidden": "true",
        focusable: "false",
        width: "108",
        height: "45",
        viewBox: "0 0 108 45",
        fill: "none",
        xmlns: "http://www.w3.org/2000/svg",
      },
    });
    svg.createSvg("path", { attr: { d: SAY_LOGO_PATH, fill: "currentColor" } });

    this.statusEl = contentEl.createDiv({ cls: "voice-notes-status" });

    const visualizerEl = contentEl.createDiv({ cls: "voice-notes-visualizer" });
    this.canvasEl = visualizerEl.createEl("canvas", { cls: "voice-notes-canvas" });
    this.canvasEl.width = 280;
    this.canvasEl.height = 64;

    this.timerEl = contentEl.createDiv({ cls: "voice-notes-timer is-hidden" });

    this.buttonContainerEl = contentEl.createDiv({ cls: "voice-notes-buttons" });

    this.applyState();
  }

  onClose() {
    this.cleanup();
    this.contentEl.empty();
  }

  private cleanup() {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.stopVisualizer();
  }

  // ── Visualizer ────────────────────────────────────────────────────────────

  private cssVar(name: string, fallback: string): string {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  }

  private stopVisualizer() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
      this.analyser = null;
    }
  }

  private drawIdle() {
    this.stopVisualizer();
    const ctx = this.canvasEl.getContext("2d");
    if (!ctx) return;
    const { width: W, height: H } = this.canvasEl;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.cssVar("--background-modifier-border", "#444");
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();
  }

  private drawWaveform() {
    if (!this.analyser) return;
    const ctx = this.canvasEl.getContext("2d");
    if (!ctx) return;
    const { width: W, height: H } = this.canvasEl;
    const bufferLength = this.analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);
    const color = this.cssVar("--color-red", "#e05252");

    const tick = () => {
      this.animFrameId = requestAnimationFrame(tick);
      if (this.analyser) this.analyser.getByteTimeDomainData(data);
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.beginPath();
      const slice = W / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const y = (data[i] / 128) * (H / 2);
        if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
        x += slice;
      }
      ctx.lineTo(W, H / 2);
      ctx.stroke();
    };
    tick();
  }

  private drawProcessing() {
    this.stopVisualizer();
    const ctx = this.canvasEl.getContext("2d");
    if (!ctx) return;
    const { width: W, height: H } = this.canvasEl;
    const color = this.cssVar("--interactive-accent", "#6c63ff");
    let phase = 0;

    const tick = () => {
      this.animFrameId = requestAnimationFrame(tick);
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      for (let x = 0; x <= W; x++) {
        const y = H / 2 + Math.sin((x / W) * Math.PI * 6 + phase) * 14;
        if (x === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      phase += 0.07;
    };
    tick();
  }

  private transition(state: ModalState) {
    this.state = state;
    this.applyState();
  }

  private applyState() {
    this.buttonContainerEl.empty();
    this.timerEl.setText("");
    this.timerEl.addClass("is-hidden");

    switch (this.state) {
      case "idle": {
        this.statusEl.setText("Will insert at cursor position.");
        this.statusEl.removeClass("error");
        this.drawIdle();

        const btn = this.buttonContainerEl.createEl("button", {
          text: "Start recording",
          cls: "mod-cta voice-notes-btn",
        });
        btn.addEventListener("click", () => { void this.startRecording(); });
        break;
      }

      case "recording": {
        this.statusEl.setText("Recording…");
        this.statusEl.removeClass("error");
        this.timerEl.removeClass("is-hidden");
        this.timerEl.setText("0:00");

        const stopBtn = this.buttonContainerEl.createEl("button", {
          text: "Stop & process",
          cls: "mod-warning voice-notes-btn",
        });
        stopBtn.addEventListener("click", () => this.stopRecording());

        const cancelBtn = this.buttonContainerEl.createEl("button", {
          text: "Cancel",
          cls: "voice-notes-btn",
        });
        cancelBtn.addEventListener("click", () => this.cancelRecording());
        break;
      }

      case "processing": {
        this.statusEl.removeClass("error");
        this.drawProcessing();
        break;
      }

      case "done": {
        this.statusEl.setText("Inserted into current note!");
        this.statusEl.removeClass("error");

        const againBtn = this.buttonContainerEl.createEl("button", {
          text: "Record another",
          cls: "voice-notes-btn",
        });
        againBtn.addEventListener("click", () => {
          this.audioChunks = [];
          this.recordingSeconds = 0;
          this.transition("idle");
        });

        const closeBtn = this.buttonContainerEl.createEl("button", {
          text: "Close",
          cls: "voice-notes-btn",
        });
        closeBtn.addEventListener("click", () => this.close());
        break;
      }

      case "error": {
        this.statusEl.addClass("error");

        const retryBtn = this.buttonContainerEl.createEl("button", {
          text: "Try again",
          cls: "mod-cta voice-notes-btn",
        });
        retryBtn.addEventListener("click", () => {
          this.audioChunks = [];
          this.recordingSeconds = 0;
          this.transition("idle");
        });

        const closeBtn = this.buttonContainerEl.createEl("button", {
          text: "Close",
          cls: "voice-notes-btn",
        });
        closeBtn.addEventListener("click", () => this.close());
        break;
      }
    }
  }

  private async startRecording() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.statusEl.setText(
        "Microphone access denied. Please allow microphone access in system settings."
      );
      this.transition("error");
      return;
    }

    this.audioChunks = [];

    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : "";

    this.mediaRecorder = new MediaRecorder(
      this.stream,
      mimeType ? { mimeType } : undefined
    );

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => { void this.processAudio(); };
    this.mediaRecorder.start(100);

    this.audioCtx = new AudioContext();
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    const stream = this.stream;
    this.audioCtx.createMediaStreamSource(stream).connect(this.analyser);

    this.recordingSeconds = 0;
    this.timerInterval = setInterval(() => {
      this.recordingSeconds++;
      const m = Math.floor(this.recordingSeconds / 60);
      const s = this.recordingSeconds % 60;
      this.timerEl.setText(`${m}:${s.toString().padStart(2, "0")}`);
    }, 1000);

    this.transition("recording");
    this.drawWaveform();
  }

  private stopRecording() {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop(); // triggers onstop → processAudio
    }
    this.stopVisualizer();
    this.transition("processing");
  }

  private cancelRecording() {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      // Swap out onstop so the recorded chunks are discarded, not processed
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.stopVisualizer();
    this.audioChunks = [];
    this.recordingSeconds = 0;
    this.transition("idle");
  }

  private async processAudio() {
    if (this.audioChunks.length === 0) {
      this.statusEl.setText("No audio was captured. Please try again.");
      this.transition("error");
      return;
    }

    const audioBlob = new Blob(this.audioChunks, { type: "audio/webm" });

    try {
      this.statusEl.setText("Transcribing audio…");
      const transcript = await transcribeAudio(
        audioBlob,
        this.settings.openAiApiKey
      );

      if (!transcript) {
        throw new Error(
          "Transcription returned empty text. Please speak clearly and try again."
        );
      }

      if (!this.activeEditor) {
        throw new Error("No active note. Open a note and place your cursor before recording.");
      }

      this.statusEl.setText("Generating summary and tags…");
      const result = await processWithClaude(transcript, this.settings);

      insertIntoCurrentNote(result, this.settings, this.activeEditor);

      this.close();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "An unknown error occurred.";
      console.error("[Say]", err);
      this.statusEl.setText(msg);
      this.transition("error");
    }
  }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────

class VoiceNotesSettingTab extends PluginSettingTab {
  plugin: VoiceNotesPlugin;

  constructor(app: App, plugin: VoiceNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("API keys").setHeading();

    new Setting(containerEl)
      .setName("Anthropic API key")
      .setDesc("Used for Claude summarization and tagging.")
      .addText((text) => {
        text
          .setPlaceholder("sk-ant-…")
          .setValue(this.plugin.settings.anthropicApiKey)
          .onChange(async (value) => {
            this.plugin.settings.anthropicApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.addClass("voice-notes-input-full");
      });

    new Setting(containerEl)
      .setName("OpenAI API key")
      .setDesc("Used for Whisper audio transcription.")
      .addText((text) => {
        text
          .setPlaceholder("sk-…")
          .setValue(this.plugin.settings.openAiApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openAiApiKey = value.trim();
            await this.plugin.saveSettings();
          });
        text.inputEl.type = "password";
        text.inputEl.addClass("voice-notes-input-full");
      });

    new Setting(containerEl).setName("Claude").setHeading();

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Which Claude model to use for summarization.")
      .addDropdown((drop) =>
        drop
          .addOption("claude-opus-4-6", "Claude Opus 4.6 — most capable")
          .addOption("claude-sonnet-4-6", "Claude Sonnet 4.6 — fast & smart")
          .addOption("claude-haiku-4-5", "Claude Haiku 4.5 — fastest")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom instructions")
      .setDesc(
        'Shape how Claude writes your summaries. E.g. "Use bullet points" or "Focus on action items only".'
      )
      .addTextArea((text) => {
        text
          .setPlaceholder("You are a precise transcription analyst…")
          .setValue(this.plugin.settings.customInstructions)
          .onChange(async (value) => {
            this.plugin.settings.customInstructions = value;
            await this.plugin.saveSettings();
          });
        text.inputEl.rows = 4;
        text.inputEl.addClass("voice-notes-input-full");
      });

    new Setting(containerEl)
      .setName("Extract tags")
      .setDesc(
        "Ask Claude to extract people, places, and topics as searchable tags."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableTags)
          .onChange(async (value) => {
            this.plugin.settings.enableTags = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Notes").setHeading();

    new Setting(containerEl)
      .setName("Include full transcript")
      .setDesc("Append the raw transcription in each note or insertion.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.includeTranscript)
          .onChange(async (value) => {
            this.plugin.settings.includeTranscript = value;
            await this.plugin.saveSettings();
          })
      );
  }
}

// ─── Main Plugin ──────────────────────────────────────────────────────────

export default class VoiceNotesPlugin extends Plugin {
  settings!: VoiceNotesSettings;

  async onload() {
    await this.loadSettings();

    this.addRibbonIcon("mic", "Record voice note", () =>
      this.openRecordingModal()
    );

    this.addCommand({
      id: "record-voice-note",
      name: "Record voice note",
      callback: () => this.openRecordingModal(),
    });

    this.addSettingTab(new VoiceNotesSettingTab(this.app, this));
  }

  onunload() {}

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);

    // Check the raw saved version (before merge) so DEFAULT_SETTINGS doesn't
    // mask a missing/old promptVersion in the stored data.
    const savedVersion: number = saved?.promptVersion ?? 0;
    if (savedVersion < PROMPT_VERSION) {
      this.settings.customInstructions = DEFAULT_SETTINGS.customInstructions;
      this.settings.promptVersion = PROMPT_VERSION;
      await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private openRecordingModal() {
    if (!this.settings.anthropicApiKey) {
      new Notice("Say: add your Anthropic API key in settings → Say.");
      return;
    }
    if (!this.settings.openAiApiKey) {
      new Notice("Say: add your OpenAI API key in settings → Say.");
      return;
    }
    // getMostRecentLeaf() survives ribbon/command-palette focus shifts,
    // unlike getActiveViewOfType() which returns null once focus moves.
    const leaf = this.app.workspace.getMostRecentLeaf();
    const activeEditor =
      leaf?.view instanceof MarkdownView ? leaf.view.editor : null;
    new RecordingModal(this.app, this.settings, activeEditor).open();
  }
}
