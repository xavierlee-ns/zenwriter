import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from "docx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.static(join(__dirname, "public")));

// Check which AI providers are available
const hasApiKey = !!process.env.GEMINI_API_KEY;
let ai = null;
if (hasApiKey) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

const hasClaudeKey = !!process.env.ANTHROPIC_API_KEY;
let claude = null;
if (hasClaudeKey) {
  claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const CLAUDE_MODEL = "claude-sonnet-5";

// Extract JSON from a Claude response, tolerating stray markdown code fences
function parseClaudeJson(text) {
  const cleaned = text.trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

async function callGemini(prompt) {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: { responseMimeType: "application/json" }
  });
  return JSON.parse(response.text);
}

async function callClaude(prompt) {
  const response = await claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1536,
    messages: [{
      role: "user",
      content: `${prompt}\n\nRespond with ONLY the raw JSON object — no markdown code fences, no commentary before or after.`
    }]
  });
  const text = response.content.map(block => block.type === "text" ? block.text : "").join("");
  return parseClaudeJson(text);
}

// Tries Gemini first, falls back to Claude on failure (e.g. rate limits),
// then falls back to the local pattern-based engine if both are unavailable/failing.
// Returns { provider: "gemini"|"claude"|"local", data: object|null }
async function runAIWithFallback(prompt, preferLocal) {
  if (preferLocal) {
    return { provider: "local", data: null };
  }

  if (hasApiKey) {
    try {
      const data = await callGemini(prompt);
      return { provider: "gemini", data };
    } catch (err) {
      console.error("Gemini request failed, trying Claude:", err.message);
    }
  }

  if (hasClaudeKey) {
    try {
      const data = await callClaude(prompt);
      return { provider: "claude", data };
    } catch (err) {
      console.error("Claude request failed, falling back to local:", err.message);
    }
  }

  return { provider: "local", data: null };
}

// ─── Show Don't Tell: Local Pattern Database ───
const tellingPatterns = [
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(sad|sadness)\b/gi,
    issue: "Directly naming the emotion instead of showing it",
    alternatives: [
      "Her shoulders curled inward, fingers twisting the hem of her sleeve",
      "He stared at the untouched plate, pushing food in slow circles with his fork",
      "A heaviness settled behind their eyes, the kind that made blinking feel like work"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(happy|glad|joyful|elated)\b/gi,
    issue: "Naming happiness rather than letting the reader feel it",
    alternatives: [
      "A laugh bubbled up from somewhere deep, the kind that made strangers smile back",
      "He caught himself humming — actually humming — for the first time in months",
      "The corners of her mouth kept sneaking upward no matter how hard she tried to play it cool"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(angry|furious|mad|enraged)\b/gi,
    issue: "Telling the reader about anger instead of showing its physical signs",
    alternatives: [
      "Her jaw clenched so tight the muscles in her neck stood out like cords",
      "He set the glass down with a crack that silenced the room",
      "Words came through gritted teeth, each one bitten off and spat out"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(tired|exhausted|weary|drained)\b/gi,
    issue: "Stating exhaustion rather than showing its weight",
    alternatives: [
      "Her keys missed the lock three times before her trembling fingers found the slot",
      "He sank into the chair like his bones had turned to sand",
      "The coffee had gone cold hours ago, but lifting the mug felt like too much to ask"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(scared|afraid|frightened|terrified)\b/gi,
    issue: "Labeling fear instead of putting the reader inside it",
    alternatives: [
      "Her pulse hammered in her ears, drowning out everything but the sound of her own breathing",
      "His hands wouldn't stop shaking — he shoved them in his pockets where no one could see",
      "Every shadow in the hallway seemed to lean closer"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(lonely|alone|isolated)\b/gi,
    issue: "Naming loneliness rather than evoking it",
    alternatives: [
      "The apartment echoed with the sound of a single spoon clinking against a bowl",
      "She scrolled through her contacts, thumb hovering over name after name, calling no one",
      "The other side of the bed had been cold so long it didn't even smell like anyone anymore"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(nervous|anxious|worried)\b/gi,
    issue: "Telling nervousness instead of showing its restless energy",
    alternatives: [
      "She rearranged the magazines on the table for the third time in five minutes",
      "His knee bounced under the desk like a sewing machine needle",
      "The words she'd rehearsed all morning scattered like startled birds"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(confused|lost|bewildered)\b/gi,
    issue: "Stating confusion rather than letting the reader experience it",
    alternatives: [
      "She read the letter again, then turned it over as if the back might hold some missing piece",
      "His mouth opened, closed, opened again — a fish pulled from water it had known its whole life",
      "The words on the page rearranged themselves every time she thought she understood"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(proud|accomplished)\b/gi,
    issue: "Naming pride instead of showing it in posture and action",
    alternatives: [
      "She stood a little taller as she pinned the certificate to the wall, stepping back to admire it twice",
      "A grin spread across his face that no amount of modesty could contain",
      "She caught her reflection in the window and, for once, didn't look away"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(was|were|felt|seemed|appeared)\s+(guilty|ashamed)\b/gi,
    issue: "Labeling guilt rather than showing its weight",
    alternatives: [
      "She couldn't meet his eyes, suddenly fascinated by a crack in the floor tile",
      "The apology sat in his throat like a stone he couldn't swallow or spit out",
      "Every time the phone rang, her stomach dropped — convinced this was the call that would undo her"
    ]},
  { regex: /\bit was\s+(a\s+)?(beautiful|lovely|gorgeous|wonderful|terrible|horrible|awful)\s+(day|morning|evening|night)\b/gi,
    issue: "Summarizing atmosphere instead of immersing the reader in it",
    alternatives: [
      "Sunlight pooled on the kitchen floor like warm honey, and somewhere a cardinal was showing off",
      "The kind of morning where the air tasted clean and the whole world seemed to exhale",
      "Gray clouds hung so low they seemed to graze the rooftops, pressing the day flat"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(loved|hated|adored|despised)\s+(her|him|them|it|the)\b/gi,
    issue: "Declaring feelings directly — let actions and details carry the emotion",
    alternatives: [
      "She kept his coffee mug on the shelf long after it chipped, washing it by hand each time",
      "Every time his name came up, she found something urgent to do in another room",
      "He traced the edges of the photograph with his thumb until the corners went soft"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(started|began)\s+to\s+(cry|weep|sob)\b/gi,
    issue: "Narrating the onset of tears — show what the body does instead",
    alternatives: [
      "Her vision blurred and the words on the page swam together like watercolors in rain",
      "A sound escaped him — something between a laugh and a gasp — and then he couldn't stop",
      "She pressed her palm hard against her mouth, as if she could hold it all in"
    ]},
  { regex: /\bthe room was\s+(silent|quiet|loud|noisy|dark|bright)\b/gi,
    issue: "Telling what the room was rather than letting the reader sense it",
    alternatives: [
      "The only sound was the clock on the mantel, ticking like a slow heartbeat",
      "Fluorescent light buzzed overhead, turning everyone's skin the color of old paper",
      "Shadows pooled in the corners where the lamplight couldn't reach"
    ]},
  { regex: /\b(she|he|they|i|we)\s+(couldn't|could not)\s+(believe|understand|comprehend)\b/gi,
    issue: "Telling disbelief — show the moment of impact instead",
    alternatives: [
      "She read it again. Then once more. The words didn't change, but the room tilted slightly",
      "His hand froze mid-reach, hovering in the air like a question that forgot its ending",
      "The news landed in her chest like a bird hitting a window — sudden, breathless, wrong"
    ]},
];

const momentumNudges = [
  "You're in the flow — don't stop now, the next line is already forming.",
  "That last bit had real texture. Keep pulling that thread.",
  "Your reader is leaning in. Give them the next moment.",
  "Trust your instincts — write the scene only you can write.",
  "The messy draft is the brave draft. Keep going.",
  "You're not just writing words, you're building a bridge to someone who needs this story.",
  "The best writing happens when you stop thinking and start feeling. Stay here.",
  "Every sentence you write is one sentence closer to the book someone needs to read.",
  "You've got momentum — ride this wave.",
  "This is the part where the magic happens. Don't look back, look forward.",
  "Remember: done is better than perfect. Keep moving.",
  "Your experience is your superpower. Let it flow onto the page.",
];

const vibeDescriptions = [
  "There's a raw honesty here that pulls the reader in close",
  "The emotional undercurrent is strong — you're building real tension",
  "You're finding a rhythm that balances vulnerability with strength",
  "There's warmth in these words that a caregiver would recognize instantly",
  "You're writing with the kind of specificity that turns a story into a mirror",
  "The pacing feels natural, like a conversation over late-night coffee",
  "There's a quiet power in the way you're layering detail and emotion",
  "You're letting the reader discover the feelings instead of announcing them",
];

// ─── Local Vibe Check ───
function localVibeCheck(text, sprintGoal) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const lastFewSentences = sentences.slice(-3).join(' ').trim();
  const words = text.trim().split(/\s+/);

  // Pick a vibe description
  const vibe = vibeDescriptions[Math.floor(Math.random() * vibeDescriptions.length)];
  const vibeSummary = `${vibe}. You've written ${words.length} words in this stretch — that's real progress. ${lastFewSentences.length > 50 ? "Your recent sentences have a strong emotional core that's worth building on." : "Keep building — the next paragraph is where things get interesting."}`;

  // Generate contextual next sentence options based on last sentence
  const lastSentence = sentences[sentences.length - 1]?.trim() || '';
  const nextSentences = generateNextSentences(lastSentence, sprintGoal);

  const nudge = momentumNudges[Math.floor(Math.random() * momentumNudges.length)];

  return { vibeSummary, nextSentences, momentumNudge: nudge };
}

function generateNextSentences(lastSentence, sprintGoal) {
  const lower = lastSentence.toLowerCase();

  // Dialogue continuation
  if (lastSentence.includes('"') || lastSentence.includes("'")) {
    return [
      'A: The silence that followed said more than any words could — it filled the room like smoke.',
      'B: "You don\'t have to explain," she said, but her eyes were already asking the question her mouth wouldn\'t.',
      'C: He opened his mouth to respond, then closed it, choosing instead to reach across the table and take her hand.'
    ];
  }

  // If about caregiving/family/health
  if (lower.match(/\b(mom|dad|mother|father|parent|family|hospital|doctor|diagnosis|medication|care|remember|forgot|memory)\b/)) {
    return [
      "A: That was the moment I learned that love isn't a feeling — it's a series of small, exhausting, sacred choices.",
      "B: The fluorescent lights hummed their indifferent lullaby while I sat in the plastic chair, pretending to read a magazine from 2019.",
      "C: She looked at me with eyes that held thirty years of Tuesday dinners and Saturday morning cartoons, and then asked me my name."
    ];
  }

  // If emotional content
  if (lower.match(/\b(heart|tears|cry|laugh|smile|breath|hand|touch|hold|love|miss|remember|hope|fear)\b/)) {
    return [
      "A: It's the small moments that ambush you — the grocery list in her handwriting still stuck to the fridge.",
      "B: I wanted to say something profound, but all that came out was a laugh that cracked open in the middle.",
      "C: Somewhere between the second and third deep breath, I remembered that I was allowed to feel this."
    ];
  }

  // Default/general
  return [
    "A: The thing nobody tells you about being a caregiver is that you grieve someone who's still in the room.",
    "B: I poured two cups of coffee that morning — one out of habit, one out of hope — and sat with both.",
    "C: Outside the window, the neighbors carried on with their ordinary lives, and I envied them with a fierceness that surprised me."
  ];
}

// ─── Local Show Don't Tell ───
function localShowDontTell(text) {
  const tellInstances = [];

  for (const pattern of tellingPatterns) {
    const matches = text.matchAll(pattern.regex);
    for (const match of matches) {
      const alt = pattern.alternatives[Math.floor(Math.random() * pattern.alternatives.length)];
      tellInstances.push({
        original: match[0],
        issue: pattern.issue,
        showAlternative: alt
      });
      if (tellInstances.length >= 5) break;
    }
    if (tellInstances.length >= 5) break;
  }

  let overallScore;
  const sentenceCount = (text.match(/[.!?]+/g) || []).length || 1;
  const ratio = tellInstances.length / sentenceCount;
  if (ratio > 0.3) overallScore = "mostly_telling";
  else if (ratio > 0.1) overallScore = "balanced";
  else overallScore = "mostly_showing";

  // Generate praise based on what's in the text
  let praise;
  if (text.match(/["'].+["']/)) {
    praise = "Your dialogue feels natural and alive — that's one of the strongest ways to show character and emotion. Keep letting your characters speak.";
  } else if (text.match(/\b(fingers|hands|eyes|shoulders|jaw|chest|stomach|throat|breath)\b/i)) {
    praise = "You're using body language and physical detail beautifully — that's exactly how you pull a reader into a character's experience.";
  } else if (text.match(/\b(smell|sound|taste|light|shadow|cold|warm|bright|dark|echo|silence)\b/i)) {
    praise = "Your sensory details are doing heavy lifting here — the reader can see and feel this scene. That's the gold standard of showing.";
  } else {
    praise = "You're building a scene with real emotional texture. Trust your instincts — your life experience gives you details no one else can write.";
  }

  return { overallScore, tellInstances, praise };
}

// ─── API Status endpoint ───
app.get("/api/status", (req, res) => {
  res.json({
    aiEnabled: hasApiKey || hasClaudeKey,
    geminiEnabled: hasApiKey,
    claudeEnabled: hasClaudeKey,
  });
});

// ─── Vibe Check endpoint ───
app.post("/api/vibe-check", async (req, res) => {
  const { text, sprintGoal, preferLocal } = req.body;

  if (!text || text.trim().length < 20) {
    return res.status(400).json({ error: "Write a bit more before a vibe check!" });
  }

  const sprintContext = sprintGoal
    ? `\n\nThe writer's current sprint goal is: "${sprintGoal}". Keep suggestions aligned with this goal.`
    : "";

  const prompt = `You are a warm, encouraging writing coach helping a first-time author write a semi-autobiographical fiction book that supports caregivers of family members with mental health issues. The book should be inspirational, emotional, funny, and discreetly instructive.

Here is what the writer just wrote:
---
${text}
---
${sprintContext}

Do three things:
1. **Vibe Summary**: In 2-3 sentences, reflect back the emotional energy and momentum of what they just wrote. Be specific and encouraging — name what's working.
2. **Three Next Sentences**: Give exactly 3 exciting, distinct options for the very next sentence they could write. Each should take the story in a slightly different direction. Make them vivid and momentum-building. Label them A, B, C.
3. **Momentum Nudge**: One short, energizing sentence to keep them writing (think: coach on the sideline, not professor at a lectern).

Format your response as JSON:
{
  "vibeSummary": "...",
  "nextSentences": ["A: ...", "B: ...", "C: ..."],
  "momentumNudge": "..."
}`;

  const { provider, data } = await runAIWithFallback(prompt, preferLocal);
  if (data) {
    return res.json({ ...data, provider });
  }

  // Local fallback
  res.json({ ...localVibeCheck(text, sprintGoal), provider: "local" });
});

// ─── Show Don't Tell endpoint ───
app.post("/api/show-dont-tell", async (req, res) => {
  const { text, preferLocal } = req.body;

  if (!text || text.trim().length < 20) {
    return res.status(400).json({ error: "Need more text to analyze." });
  }

  const prompt = `You are a gentle but precise writing coach specializing in "show don't tell" technique. The writer is crafting a semi-autobiographical fiction book for caregivers.

Analyze this passage for "telling" vs "showing":
---
${text}
---

Find phrases where the writer TELLS emotions or states directly (e.g., "She was sad", "He felt angry", "It was a beautiful day") and suggest how to SHOW them through:
- **Sensory details** (sight, sound, smell, touch, taste)
- **Body language and physical reactions**
- **Dialogue and action**
- **Environmental details that mirror emotion**

Format as JSON:
{
  "overallScore": "mostly_showing" | "balanced" | "mostly_telling",
  "tellInstances": [
    {
      "original": "the exact telling phrase",
      "issue": "brief explanation of why this is telling",
      "showAlternative": "a rewritten version that shows instead"
    }
  ],
  "praise": "one specific thing they're already showing well (be genuine)"
}

If the writing is already strong in showing, return fewer or zero tellInstances and celebrate that in praise. Maximum 5 instances.`;

  const { provider, data } = await runAIWithFallback(prompt, preferLocal);
  if (data) {
    return res.json({ ...data, provider });
  }

  // Local fallback
  res.json({ ...localShowDontTell(text), provider: "local" });
});

// ─── Export to .docx ───
app.post("/api/export-docx", async (req, res) => {
  const { text, title } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Nothing to export." });
  }

  const docTitle = title || "My Writing";
  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());

  const children = [
    // Title
    new Paragraph({
      children: [
        new TextRun({
          text: docTitle,
          bold: true,
          size: 52,
          font: "Georgia",
        }),
      ],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    // Date
    new Paragraph({
      children: [
        new TextRun({
          text: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
          italics: true,
          size: 20,
          color: "888888",
          font: "Georgia",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
    // Divider
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      },
      spacing: { after: 400 },
    }),
  ];

  // Body paragraphs
  for (const para of paragraphs) {
    // Handle line breaks within a paragraph
    const lines = para.split(/\n/).filter(l => l.trim());
    const runs = [];

    lines.forEach((line, i) => {
      runs.push(new TextRun({
        text: line.trim(),
        size: 24,
        font: "Georgia",
      }));
      if (i < lines.length - 1) {
        runs.push(new TextRun({ break: 1 }));
      }
    });

    children.push(new Paragraph({
      children: runs,
      spacing: { after: 240, line: 360 },
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });

  try {
    const buffer = await Packer.toBuffer(doc);
    const filename = `${docTitle.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "Export failed." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  🧘 Mindful Writing Assistant`);
  console.log(`  ────────────────────────────`);
  console.log(`  Running at http://localhost:${PORT}`);
  if (hasApiKey) {
    console.log(`  ✓ Gemini API connected (primary)`);
  }
  if (hasClaudeKey) {
    console.log(`  ✓ Claude API connected (${hasApiKey ? "fallback" : "primary"})`);
  }
  if (!hasApiKey && !hasClaudeKey) {
    console.log(`  ◆ Local mode: Using built-in writing coach (no API key needed)`);
    console.log(`  ◆ Set GEMINI_API_KEY and/or ANTHROPIC_API_KEY to unlock AI-powered features`);
  }
  console.log();
});
