import { grokGenerateWithResume, BUDGET } from "./grokService";

// Config Constants (loaded from environment variables)
const ASSEMBLYAI_API_KEY = import.meta.env.VITE_ASSEMBLYAI_API_KEY;
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

const VIDEO_CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`;
const RESUME_CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
const AUTO_CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
const RAW_CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload`;
const ASSEMBLYAI_TRANSCRIPT_ENDPOINT = 'https://api.assemblyai.com/v2/transcript';

// ── Token-saving helpers ──────────────────────────────────────────────────────
// Truncate long strings at the source so we never send walls of text to the API.
const truncate = (s: string, max: number) =>
  s && s.length > max ? s.slice(0, max) + '…' : (s || '');

// Resume: 800 chars is enough to convey skills/titles. Full PDF text is wasteful.
const RESUME_MAX_CHARS = 800;
// JD: 600 chars keeps the role context without padding.
const JD_MAX_CHARS = 600;
// Transcript per answer: cap long rambling answers to save feedback input tokens.
const TRANSCRIPT_MAX_CHARS = 300;

// ── TTS ───────────────────────────────────────────────────────────────────────
export const generateOpenAITTS = async (text: string) => {
  const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
  if (!OPENAI_API_KEY) {
    throw new Error("OpenAI API key missing. Add VITE_OPENAI_API_KEY to .env.");
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ model: "tts-1", input: text, voice: "alloy" })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || "OpenAI TTS failed");
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
};

// ── Interview Question Generation ─────────────────────────────────────────────
export const generateInterviewQuestions = async (
  jobTitle: string,
  jobDescription: string,
  candidateExp: string,
  base64Resume: string,
  mimeType: string,
  languageCode: string = 'en',
  numQuestions: number = 5
) => {
  const lang = languageCode === 'mr' ? 'Marathi (Devanagari script only)'
             : languageCode === 'hi' ? 'Hindi (Devanagari script only)'
             : 'English';

  // Truncate to save input tokens
  const jd  = truncate(jobDescription, JD_MAX_CHARS);
  const exp = truncate(candidateExp, 150);

  // Compact prompt — same intent, ~40% fewer tokens than before
  const prompt =
`Generate exactly ${numQuestions} interview questions for role: "${jobTitle}".
JD: ${jd}
Experience: ${exp}
Rules: one question per line, no numbering/bullets/preamble/closing text.
Language: ${lang}.`;

  try {
    const sys = "You are an AI interviewer. Output only the requested questions, nothing else.";
    const text = await grokGenerateWithResume(sys, prompt, base64Resume, mimeType, 0.5, BUDGET.QUESTIONS);
    const clean = text.replace(/^\s*[\d\.\-\*\+]+\s*/gm, '').replace(/\*\*/g, '').trim();
    return clean.split('\n').map(q => q.trim()).filter(q => q && q.length > 10).slice(0, numQuestions);
  } catch (error: any) {
    console.error("Grok Generate Questions Error:", error);
    throw new Error(error.message || "Failed to generate questions");
  }
};

// ── Feedback / Report Generation ──────────────────────────────────────────────
export const generateFeedback = async (
  jobTitle: string,
  jobDescription: string,
  candidateExp: string,
  base64Resume: string,
  mimeType: string,
  questions: string[],
  transcripts: string[]
) => {
  const jd  = truncate(jobDescription, JD_MAX_CHARS);
  const exp = truncate(candidateExp, 150);

  // Build Q&A block — each transcript is capped to save tokens
  const qaBlock = questions.map((q, i) => {
    const ans = truncate(transcripts[i] || '(unavailable)', TRANSCRIPT_MAX_CHARS);
    return `Q${i + 1}: ${q}\nA${i + 1}: ${ans}`;
  }).join('\n---\n');

  // Compact feedback prompt — output capped to 1-2 lines per section as requested
  const feedbackPrompt =
`Evaluate candidate for "${jobTitle}".
JD: ${jd}
Experience: ${exp}

Q&A:
${qaBlock}

Output EXACTLY this format (2 lines max per section):
**Resume Analysis:** [2 lines max on resume-job fit]
**Answer Quality:** [2 lines max on communication/relevance]
**Overall Evaluation:** [1 sentence summary]
**Scores:**
Resume Score: [0-100]/100
Q&A Score: [0-100]/100
Overall Score: [0-100]/100`;

  try {
    const sys = "You are a hiring evaluator. Follow the output format exactly. Be concise.";
    const result = await grokGenerateWithResume(sys, feedbackPrompt, base64Resume, mimeType, 0.3, BUDGET.FEEDBACK);
    return result || "AI feedback generation failed.";
  } catch (error: any) {
    console.error("Grok Feedback Error:", error);
    throw new Error(error.message);
  }
};

// ── Cloudinary ────────────────────────────────────────────────────────────────
export const uploadToCloudinary = async (blob: Blob, resourceType: 'video' | 'image' | 'auto' | 'raw' = 'auto') => {
  const isVideo = resourceType === 'video';
  const isRaw = resourceType === 'raw';
  const uploadUrl = resourceType === 'auto'
    ? AUTO_CLOUDINARY_UPLOAD_URL
    : (isVideo ? VIDEO_CLOUDINARY_UPLOAD_URL : (isRaw ? RAW_CLOUDINARY_UPLOAD_URL : RESUME_CLOUDINARY_UPLOAD_URL));

  const formData = new FormData();
  formData.append('file', blob);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  try {
    const response = await fetch(uploadUrl, { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error?.message || response.statusText);
    return data.secure_url;
  } catch (error: any) {
    console.error("Cloudinary Upload Error:", error);
    throw error;
  }
};

// ── AssemblyAI ────────────────────────────────────────────────────────────────
export const requestTranscription = async (audioUrl: string, languageCode: string = 'en') => {
  try {
    const body: any = { audio_url: audioUrl, language_code: languageCode };
    if (languageCode !== 'en') body.speech_model = 'nano';
    const response = await fetch(ASSEMBLYAI_TRANSCRIPT_ENDPOINT, {
      method: 'POST',
      headers: { 'authorization': ASSEMBLYAI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Transcription request failed");
    return data.id;
  } catch (error: any) {
    console.error("AssemblyAI Request Error:", error);
    throw error;
  }
};

export const fetchTranscriptText = async (transcriptId: string) => {
  try {
    const response = await fetch(`${ASSEMBLYAI_TRANSCRIPT_ENDPOINT}/${transcriptId}`, {
      method: 'GET',
      headers: { 'authorization': ASSEMBLYAI_API_KEY }
    });
    const data = await response.json();
    if (data.status === 'completed') return { status: 'completed', text: data.text || '(No speech detected)' };
    if (data.status === 'error') return { status: 'error', text: `Error: ${data.error}` };
    return { status: data.status, text: null };
  } catch (error: any) {
    return { status: 'error', text: `Error: ${error.message}` };
  }
};