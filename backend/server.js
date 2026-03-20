const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");


const app = express();
const PORT = process.env.PORT || 3000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TEXT_MODEL = "openai/gpt-oss-20b";

const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (_req, file, cb) {
    const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`;
    cb(null, safeName);
  }
});

const upload = multer({ storage });

function extractJson(text) {
  if (!text || typeof text !== "string") {
    throw new Error("Model returned empty response");
  }

  const cleaned = text.replace(/```json|```/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in model response:\n${cleaned.slice(0, 1200)}`);
  }

  const jsonCandidate = cleaned.slice(start, end + 1);

  try {
    return JSON.parse(jsonCandidate);
  } catch (_error) {
    throw new Error(`Invalid JSON from model:\n${jsonCandidate.slice(0, 2000)}`);
  }
}

async function callGroq(messages, model = TEXT_MODEL, temperature = 0.2) {
  if (!GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature,
      messages
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Groq request failed");
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string" || !content.trim()) {
    console.error("EMPTY GROQ RESPONSE DATA:", JSON.stringify(data, null, 2));
    throw new Error("Groq returned an empty response");
  }

  return content;
}

async function extractTextFromFile(filePath, mimetype) {
  if (mimetype === "application/pdf") {
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);

    const fullText = data.text || "";

    const rawPages = fullText
      .split(/\f+/)
      .map((page) => page.replace(/\r/g, "\n").trim())
      .filter(Boolean);

    const pages = rawPages.length
      ? rawPages
      : fullText
          .split(/\n(?=\d+\n)|\n(?=[A-Z][^\n]{3,80}\n\d+\n)/g)
          .map((page) => page.replace(/\r/g, "\n").trim())
          .filter(Boolean);

    return {
      fullText,
      pages
    };
  }

  if (
    mimetype === "text/plain" ||
    mimetype === "text/markdown" ||
    mimetype === "application/json"
  ) {
    const text = fs.readFileSync(filePath, "utf8");
    return {
      fullText: text,
      pages: [text]
    };
  }

  throw new Error(`Unsupported file type for text extraction: ${mimetype}`);
}

function cleanChunkText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n\s*\d+\s*\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function getPageSignals(pageText) {
  const raw = String(pageText || "").replace(/\r/g, "\n").trim();
  const text = cleanChunkText(raw);
  const lower = text.toLowerCase();

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const firstLine = lines[0] || "";
  const secondLine = lines[1] || "";

  const titleLikeFirstLine =
    firstLine.length >= 4 &&
    firstLine.length <= 80 &&
    !/[.!?]$/.test(firstLine) &&
    (/[A-Z]/.test(firstLine[0]) || /^[0-9]/.test(firstLine));

  const titleLikeSecondLine =
    secondLine.length >= 4 &&
    secondLine.length <= 80 &&
    !/[.!?]$/.test(secondLine) &&
    /[A-Z]/.test(secondLine[0]);

  const titleCandidate = titleLikeFirstLine
    ? firstLine
    : titleLikeSecondLine
      ? secondLine
      : "";

  const formulaSymbolCount = (text.match(/[=÷×+\-*/%]/g) || []).length;
  const digitCount = (text.match(/\d/g) || []).length;

  const hasFormulaDensity =
    formulaSymbolCount >= 3 ||
    (formulaSymbolCount >= 2 && digitCount >= 6);

  const hasWorkedExampleStyle =
    /example|illustration|question|calculate|find|solve|what is|what’s/i.test(text);

  const hasBulletStyle =
    /(?:^|\s)(?:1\.|2\.|3\.|4\.|5\.)/.test(text) ||
    /(?:^|\s)[•\-]\s/.test(text);

  const hasDefinitionStyle =
    /\b(is|means|refers to|defined as)\b/i.test(text);

  return {
    text,
    titleCandidate,
    hasFormulaDensity,
    hasWorkedExampleStyle,
    hasBulletStyle,
    hasDefinitionStyle,
    length: text.length
  };
}

function shouldStartNewChunk(prevSignals, nextSignals) {
  if (!prevSignals) return false;

  const titleChanged =
    prevSignals.titleCandidate &&
    nextSignals.titleCandidate &&
    prevSignals.titleCandidate.toLowerCase() !== nextSignals.titleCandidate.toLowerCase();

  const overviewToDetailShift =
    prevSignals.hasBulletStyle &&
    !prevSignals.hasFormulaDensity &&
    !prevSignals.hasWorkedExampleStyle &&
    (nextSignals.hasDefinitionStyle || nextSignals.hasFormulaDensity || nextSignals.hasWorkedExampleStyle);

  const movedIntoFormulaSection =
    !prevSignals.hasFormulaDensity && nextSignals.hasFormulaDensity;

  const movedIntoWorkedExample =
    !prevSignals.hasWorkedExampleStyle && nextSignals.hasWorkedExampleStyle;

  const explanationToExampleShift =
    (prevSignals.hasDefinitionStyle || prevSignals.hasBulletStyle) &&
    (nextSignals.hasFormulaDensity || nextSignals.hasWorkedExampleStyle);

  const bigCombinedSize = prevSignals.length + nextSignals.length > 1400;

  return (
    titleChanged ||
    movedIntoFormulaSection ||
    movedIntoWorkedExample ||
    explanationToExampleShift ||
    overviewToDetailShift ||
    bigCombinedSize
  );
}

function chunkPagesSmartly(pages = []) {
  const cleanedPages = pages
    .map((page) => cleanChunkText(page))
    .filter((page) => page.length > 80);

  if (!cleanedPages.length) return [];

  const chunks = [];
  let currentPages = [];
  let prevSignals = null;

  for (const page of cleanedPages) {
    const signals = getPageSignals(page);

    if (currentPages.length === 0) {
      currentPages.push(page);
      prevSignals = signals;
      continue;
    }

    const startNew = shouldStartNewChunk(prevSignals, signals);

    if (startNew) {
      chunks.push(currentPages.join("\n\n"));
      currentPages = [page];
    } else {
      currentPages.push(page);
    }

    prevSignals = signals;
  }

  if (currentPages.length) {
    chunks.push(currentPages.join("\n\n"));
  }

  return chunks
    .map((chunk) => cleanChunkText(chunk))
    .filter((chunk) => chunk.length > 120);
}

function chunkText(text, maxChunkLength = 900) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleanText) return [];

  const sentences = cleanText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleanText];
  const chunks = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    if ((currentChunk + " " + trimmed).trim().length <= maxChunkLength) {
      currentChunk = (currentChunk + " " + trimmed).trim();
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = trimmed;
    }
  }

  if (currentChunk) chunks.push(currentChunk);

  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 120);
}

function rebalanceChunks(chunks, minLength = 300, maxLength = 900) {
  const result = [];
  let buffer = "";

  for (const chunk of chunks) {
    const candidate = buffer ? `${buffer} ${chunk}` : chunk;

    if (candidate.length <= maxLength) {
      buffer = candidate;
    } else {
      if (buffer) result.push(buffer.trim());

      if (chunk.length <= maxLength) {
        buffer = chunk;
      } else {
        result.push(...chunkText(chunk, maxLength));
        buffer = "";
      }
    }
  }

  if (buffer) result.push(buffer.trim());

  return result.filter((item) => item.length >= minLength);
}

function splitRawTextIntoBlocks(rawText) {
  return String(rawText || "")
    .replace(/\r/g, "\n")
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function buildLessonPackageFromSourceText(source) {
  if (!source) return [];

  const rawText =
    typeof source === "string"
      ? source
      : source.fullText || "";

  const blocks = splitRawTextIntoBlocks(rawText);

  if (!blocks.length) return [];

  const chunks = [];
  let currentChunk = "";
  let prevSignals = null;

  for (const block of blocks) {
    const signals = getPageSignals(block);

    if (!currentChunk) {
      currentChunk = block;
      prevSignals = signals;
      continue;
    }

    const startNew =
      shouldStartNewChunk(prevSignals, signals) ||
      (cleanChunkText(currentChunk).length + cleanChunkText(block).length > 1200);

    if (startNew) {
      chunks.push(cleanChunkText(currentChunk));
      currentChunk = block;
    } else {
      currentChunk += "\n\n" + block;
    }

    prevSignals = signals;
  }

  if (currentChunk) {
    chunks.push(cleanChunkText(currentChunk));
  }

  return chunks.filter((chunk) => chunk.length > 120);
}

function fallbackLesson(chunk, chunkIndex = 0, roadmap = []) {
  const title = roadmap[chunkIndex] || `Part ${chunkIndex + 1}`;

  return {
    sessionLabel: `Concept ${String(chunkIndex + 1).padStart(2, "0")}`,
    topicTitle: title,
    subtitle: "This section was loaded, but the tutor could not structure it properly yet.",
    lessonGoal: "Review the main idea from this part.",
    explanation: "The file text was extracted successfully, but this chunk still needs a cleaner AI explanation.",
    exampleBox: {
      label: "Extracted preview",
      text: chunk.slice(0, 220)
    },
    marginNote: "This usually means the chunk was messy or the AI response was invalid.",
    microRecap: "The content loaded, but the explanation needs to be cleaned up.",
    diagram: {
      type: "none"
    },
    quiz: {
      question: "Was this chunk converted into a proper teaching explanation?",
      options: [
        "Yes, fully",
        "No, not yet",
        "It is unrelated"
      ],
      correctIndex: 1,
      correctExplanation: "Correct — the upload worked, but the lesson still needs better structuring.",
      wrongExplanation: "This is fallback content, not the final teaching version."
    },
    summary: {
      takeaway: "The upload worked, but this lesson chunk still needs a better AI explanation.",
      bullets: [
        "The file was read correctly",
        "The chunk was extracted",
        "The teaching output still needs improving"
      ],
      whyItMatters: "This helps us tell the difference between upload problems and lesson-generation problems.",
      nextTeaser: roadmap[chunkIndex + 1] || "Next part"
    }
  };
}


function buildTutorContext({ subject, level, learningStyle }) {
  const styleRules = {
    "Explain simply, then quiz me": `
Style:
- Be clear, direct, compact, and helpful.
- Focus on one core idea at a time.
- Use one strong example when useful.
- Keep the quiz short and fair.
- Keep the summary memorable but not long.
`,
    "Talk me through it back and forth": `
Style:
- Sound guided and conversational.
- Explain like a tutor speaking to one student.
- Keep the lesson interactive and supportive.
`,
    "Give me the big picture first, then details": `
Style:
- Start with the big picture.
- Then narrow into the exact point.
- Keep the structure obvious.
`
  };

  return `
Student profile:
- Subject: ${subject || "General"}
- Level: ${level || "Undergrad"}
- Learning style: ${learningStyle || "Explain simply, then quiz me"}

${styleRules[learningStyle] || styleRules["Explain simply, then quiz me"]}
`;
}

async function generateSessionRoadmap(chunks = [], profile = {}) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      sessionIntro: "Today we’ll cover a few short parts from your material.",
      roadmap: []
    };
  }

  if (!GROQ_API_KEY) {
    return {
      sessionIntro: `Today we’ll cover ${chunks.length} short part${chunks.length === 1 ? "" : "s"} from your material.`,
      roadmap: chunks.map((_, index) => `Part ${index + 1}`)
    };
  }

  const prompt = `
You are creating a short student-friendly study roadmap.

${buildTutorContext(profile)}

You will receive lesson chunks from one uploaded study source.

Return JSON only in this exact shape:
{
  "sessionIntro": "One short tutor-style greeting explaining what will be covered today",
  "roadmap": ["Short topic title 1", "Short topic title 2", "Short topic title 3"]
}

Rules:
- This must work for ALL subjects.
- Do not assume the subject is law.
- Use only the uploaded content.
- sessionIntro must be short, warm, and clear.
- sessionIntro should say how many parts will be covered.
- roadmap must contain exactly one short topic title per chunk.
- each roadmap item must be 2 to 7 words.
- make roadmap items student-friendly.
- return JSON only.

Chunks:
${chunks.map((chunk, index) => `Chunk ${index + 1}:\n${chunk.slice(0, 350)}`).join("\n\n")}
`;

  try {
    const content = await callGroq(
      [
        {
          role: "system",
          content: "You create short lesson roadmaps and return JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      TEXT_MODEL,
      0.1
    );

    const parsed = extractJson(content);

    return {
      sessionIntro:
        typeof parsed?.sessionIntro === "string" && parsed.sessionIntro.trim()
          ? parsed.sessionIntro.trim()
          : `Today we’ll cover ${chunks.length} short part${chunks.length === 1 ? "" : "s"} from your material.`,
      roadmap:
        Array.isArray(parsed?.roadmap) && parsed.roadmap.length
          ? parsed.roadmap.slice(0, chunks.length)
          : chunks.map((_, index) => `Part ${index + 1}`)
    };
  } catch (error) {
    console.warn("Roadmap generation failed, using fallback:", error.message);

    return {
      sessionIntro: `Today we’ll cover ${chunks.length} short part${chunks.length === 1 ? "" : "s"} from your material.`,
      roadmap: chunks.map((_, index) => `Part ${index + 1}`)
    };
  }
}

function looksCalculationHeavy(text) {
  const raw = String(text || "");
  const symbolCount = (raw.match(/[=÷×+\-*/%]/g) || []).length;
  const digitCount = (raw.match(/\d/g) || []).length;
  return symbolCount >= 2 || digitCount >= 6;
}

async function generateLessonFromChunk(chunk, profile = {}, chunkIndex = 0, roadmap = [], previousContext = {}) {
  if (!GROQ_API_KEY) {
    return fallbackLesson(chunk, chunkIndex, roadmap);
  }

  const tutorContext = buildTutorContext(profile);
  const previousLessonSummary = previousContext?.explanation || "";
  const previousChunkText = previousContext?.chunkText || "";
  const roadmapTitle = roadmap?.[chunkIndex] || `Part ${chunkIndex + 1}`;
  const nextRoadmapTitle = roadmap?.[chunkIndex + 1] || "";
  const chunkLooksCalculationHeavy = looksCalculationHeavy(chunk);
  const isOverviewChunk =
  /^\s*(overview|introduction|summary|outline)\b/i.test(chunk) ||
  ((chunk.match(/\b(?:1\.|2\.|3\.|4\.|5\.)/g) || []).length >= 4 &&
   chunk.length < 900);

  const prompt = `
You are an AI tutor creating one lesson card for a student.

${tutorContext}

This product is for ALL subjects.
Do NOT assume the subject is law.
Do NOT inject law examples unless the uploaded source is actually about law.
Use only the uploaded source chunk as the truth.

Current chunk:
${chunk}

Chunk type hint:
${isOverviewChunk ? "overview" : "standard"}

Chunk calculation density:
${chunkLooksCalculationHeavy ? "high" : "normal"}

Previous chunk text:
${previousChunkText || "None"}

Previous lesson explanation:
${previousLessonSummary || "None"}

Roadmap title for this chunk:
${roadmapTitle}

Next roadmap title:
${nextRoadmapTitle || "None"}

Return JSON only in this exact shape:
{
  "sessionLabel": "Concept 01",
  "topicTitle": "Short title",
  "subtitle": "One short supporting line",
  "lessonGoal": "One short goal line",
  "explanation": "2 to 5 sentence explanation",
  "exampleBox": {
    "label": "Strong example",
    "text": "One concrete example or empty string"
  },
  "marginNote": "One short tutor-style note or empty string",
  "microRecap": "One short recap sentence",
  "diagram": {
    "type": "none",
    "title": "",
    "leftTitle": "",
    "leftBody": "",
    "rightTitle": "",
    "rightBody": "",
    "beforeLabel": "",
    "beforeValue": "",
    "afterLabel": "",
    "afterValue": "",
    "steps": [],
    "formula": ""
  },
  "quiz": {
    "question": "One short question",
    "options": ["Option A", "Option B", "Option C"],
    "correctIndex": 0,
    "correctExplanation": "Helpful explanation after correct answer",
    "wrongExplanation": "Helpful correction after wrong answer"
  },
  "summary": {
    "takeaway": "One short takeaway paragraph",
    "bullets": ["Bullet 1", "Bullet 2", "Bullet 3"],
    "whyItMatters": "Why this matters",
    "nextTeaser": "Short teaser for the next part or empty string"
  }
}

Diagram rules:
- Allowed diagram.type values:
  - "none"
  - "compare"
  - "beforeAfter"
  - "steps"
  - "formula"
- Use "none" unless a diagram would clearly help.
- For "compare", use leftTitle, leftBody, rightTitle, rightBody.
- For "beforeAfter", use beforeLabel, beforeValue, afterLabel, afterValue.
- For "steps", use steps array with 2 to 4 short steps.
- For "formula", use formula and title only.

Rules:
- Keep the lesson compact but useful.
- explanation should be informative and readable.
- If a strong example helps, include one.
- marginNote should sound like a smart tutor note, not childish.
- microRecap should help the student right before the quiz.
- quiz options must be plausible and based on the chunk.
- correctExplanation and wrongExplanation must be informative.
- summary.takeaway must capture the main idea clearly.
- summary.bullets must be specific, not generic.
- summary.whyItMatters should explain why this concept matters in the bigger subject.
- summary.nextTeaser should be based on the next topic if known.
- Do not invent facts not supported by the chunk.
- Return JSON only.
- Do NOT paste the chunk back to the student.
- Do NOT copy slide text unless quoting a very short exact term or formula.
- Rewrite the material in tutor language.
- explanation must feel taught, not extracted.
- Always explain the idea in your own words first.
- Then give one concrete example if possible.
- If the chunk includes headings, lists, or slide fragments, turn them into one clean explanation.
- If the chunk contains a formula, equation, ratio, percentage, symbolic expression, or worked calculation, you must surface it clearly.
- If the chunk includes a numerical example or calculation setup, the exampleBox should use that example.
- If the chunk is calculation-heavy, diagram.type should preferably be "formula", "steps", or "beforeAfter" instead of "none".
- If the chunk includes a calculation, the quiz should test understanding of that calculation or formula.
- Do not use placeholder quiz options.
- quiz.options must always contain exactly 3 meaningful options based on the chunk.
- All three options must be plausible.
- The correct option must be inferable from the explanation and example.
- Do not return generic options like "Option A", "Option B", or "Option C".
- If the chunk is an overview or roadmap-style chunk, the quiz must stay at overview level.
- Do not ask about a subtopic in detail unless that subtopic is explicitly taught in this chunk.
- The quiz must test only what was directly explained in the explanation section.
- If chunk type hint is overview, explain the structure at a high level and do not deep-dive into one listed subtopic.
`;

  try {
    const content = await callGroq(
      [
        {
          role: "system",
          content: "You are a teaching assistant that returns one strict JSON object only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      TEXT_MODEL,
      0.2
    );

    console.log("RAW GROQ LESSON RESPONSE:\n", content);
    const parsed = extractJson(content);

    return {
      sessionLabel: parsed?.sessionLabel || `Concept ${String(chunkIndex + 1).padStart(2, "0")}`,
      topicTitle: parsed?.topicTitle || roadmapTitle,
      subtitle: parsed?.subtitle || "A short guided lesson from your uploaded material.",
      lessonGoal: parsed?.lessonGoal || "Understand the key idea in this part.",
      explanation: parsed?.explanation || chunk.slice(0, 320),
      exampleBox: {
        label: parsed?.exampleBox?.label || "Strong example",
        text: parsed?.exampleBox?.text || ""
      },
      marginNote: parsed?.marginNote || "",
      microRecap: parsed?.microRecap || "Keep the core idea in mind for the quick check.",
      diagram: parsed?.diagram || { type: "none" },
      quiz: {
        question: parsed?.quiz?.question || "What is the main idea here?",
        options:
          Array.isArray(parsed?.quiz?.options) &&
          parsed.quiz.options.length === 3 &&
          parsed.quiz.options.every(
            (opt) =>
              typeof opt === "string" &&
              opt.trim().length > 3 &&
              !/^option\s+[abc]$/i.test(opt.trim())
         )
            ? parsed.quiz.options
            : [
                "The chunk did not generate a valid quiz option",
                "The quiz needs to be regenerated",
                "The model returned placeholder answers"
              ],
        correctIndex:
          typeof parsed?.quiz?.correctIndex === "number" ? parsed.quiz.correctIndex : 0,
        correctExplanation:
          parsed?.quiz?.correctExplanation || "Correct — you picked the key idea from this section.",
        wrongExplanation:
          parsed?.quiz?.wrongExplanation || "Not quite — focus on the main idea explained in this section."
      },
      summary: {
        takeaway: parsed?.summary?.takeaway || "This part teaches the core idea you need first.",
        bullets:
          Array.isArray(parsed?.summary?.bullets) && parsed.summary.bullets.length
            ? parsed.summary.bullets.slice(0, 3)
            : [
                "This section contains a key idea",
                "It connects to later parts",
                "You should be able to explain it simply"
              ],
        whyItMatters:
          parsed?.summary?.whyItMatters || "This helps you understand the rest of the material better.",
        nextTeaser: parsed?.summary?.nextTeaser || nextRoadmapTitle || ""
      }
    };
  } catch (error) {
  console.warn("Lesson generation failed, using fallback:", error.message);
  console.log("FAILED CHUNK:\n", chunk);
  return fallbackLesson(chunk, chunkIndex, roadmap);
}
  }

async function simplifyLessonFromChunk(chunk, profile = {}, chunkIndex = 0, roadmap = []) {
  if (!GROQ_API_KEY) {
    return fallbackLesson(chunk, chunkIndex, roadmap);
  }

  const prompt = `
You are simplifying a lesson for a student who needs a clearer retry explanation.

${buildTutorContext(profile)}

This product is for ALL subjects.
Do NOT assume the subject is law.
Use only the source chunk.

Chunk:
${chunk}

Return JSON only in the same exact shape:
{
  "sessionLabel": "Concept 01",
  "topicTitle": "Short title",
  "subtitle": "One short supporting line",
  "lessonGoal": "One short goal line",
  "explanation": "2 to 4 sentence simpler explanation",
  "exampleBox": {
    "label": "Simpler example",
    "text": "One concrete simpler example or empty string"
  },
  "marginNote": "One short tutor-style note or empty string",
  "microRecap": "One short recap sentence",
  "diagram": {
    "type": "none",
    "title": "",
    "leftTitle": "",
    "leftBody": "",
    "rightTitle": "",
    "rightBody": "",
    "beforeLabel": "",
    "beforeValue": "",
    "afterLabel": "",
    "afterValue": "",
    "steps": [],
    "formula": ""
  },
  "quiz": {
    "question": "An easier short question",
    "options": ["Option A", "Option B", "Option C"],
    "correctIndex": 0,
    "correctExplanation": "Helpful explanation after correct answer",
    "wrongExplanation": "Helpful correction after wrong answer"
  },
  "summary": {
    "takeaway": "One short takeaway paragraph",
    "bullets": ["Bullet 1", "Bullet 2", "Bullet 3"],
    "whyItMatters": "Why this matters",
    "nextTeaser": "Short teaser for the next part or empty string"
  }
}

Rules:
- Use simpler words than before.
- Keep the lesson compact.
- Try to make the example even clearer.
- Keep the answer explanations informative.
- Return JSON only.
`;

  try {
    const content = await callGroq(
      [
        {
          role: "system",
          content: "You simplify lessons and return one strict JSON object only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      TEXT_MODEL,
      0.15
    );

    const parsed = extractJson(content);

    return {
      sessionLabel: parsed?.sessionLabel || `Concept ${String(chunkIndex + 1).padStart(2, "0")}`,
      topicTitle: parsed?.topicTitle || roadmap?.[chunkIndex] || `Part ${chunkIndex + 1}`,
      subtitle: parsed?.subtitle || "A simpler retry version of this lesson.",
      lessonGoal: parsed?.lessonGoal || "Understand the key idea more clearly.",
      explanation: parsed?.explanation || chunk.slice(0, 280),
      exampleBox: {
        label: parsed?.exampleBox?.label || "Simpler example",
        text: parsed?.exampleBox?.text || ""
      },
      marginNote: parsed?.marginNote || "",
      microRecap: parsed?.microRecap || "Keep the main idea in mind for the quick check.",
      diagram: parsed?.diagram || { type: "none" },
      quiz: {
        question: parsed?.quiz?.question || "Which option best matches the main idea?",
        options:
          Array.isArray(parsed?.quiz?.options) && parsed.quiz.options.length === 3
            ? parsed.quiz.options
            : ["Option A", "Option B", "Option C"],
        correctIndex:
          typeof parsed?.quiz?.correctIndex === "number" ? parsed.quiz.correctIndex : 0,
        correctExplanation:
          parsed?.quiz?.correctExplanation || "Correct — that matches the key idea.",
        wrongExplanation:
          parsed?.quiz?.wrongExplanation || "Not quite — focus on the core idea explained above."
      },
      summary: {
        takeaway: parsed?.summary?.takeaway || "This retry version focuses on the key idea more directly.",
        bullets:
          Array.isArray(parsed?.summary?.bullets) && parsed.summary.bullets.length
            ? parsed.summary.bullets.slice(0, 3)
            : [
                "This version is simpler",
                "The key idea stays the same",
                "The example should make it clearer"
              ],
        whyItMatters:
          parsed?.summary?.whyItMatters || "This helps lock in the core idea before moving on.",
        nextTeaser: parsed?.summary?.nextTeaser || roadmap?.[chunkIndex + 1] || ""
      }
    };
  } catch (error) {
    console.warn("Retry lesson generation failed, using fallback:", error.message);
    return fallbackLesson(chunk, chunkIndex, roadmap);
  }
}

async function checkStudentAnswer({ lesson, studentAnswer, learningStyle }) {
  if (!GROQ_API_KEY) {
    return {
      result: "partly_correct",
      title: "Demo mode",
      feedback: "Groq key not set, so this is placeholder feedback.",
      helpfulCorrection: "Once your API key is live, this will return real answer feedback."
    };
  }

  const coachingRule =
    learningStyle === "Talk me through it back and forth"
      ? "Use supportive tutor language."
      : learningStyle === "Explain simply, then quiz me"
        ? "Be direct and clear."
        : "Be structured and concise.";

  const prompt = `
You are checking a student's answer to a short lesson quiz.

Lesson title:
${lesson?.topicTitle || "Untitled"}

Lesson explanation:
${lesson?.explanation || ""}

Question:
${lesson?.quiz?.question || ""}

Options:
${(lesson?.quiz?.options || []).map((opt, i) => `${i + 1}. ${opt}`).join("\n")}

Correct answer:
${lesson?.quiz?.options?.[lesson?.quiz?.correctIndex] || ""}

Student answer:
${studentAnswer}

Return JSON only in this shape:
{
  "result": "correct",
  "title": "Spot on!",
  "feedback": "Short answer feedback",
  "helpfulCorrection": "Short extra correction or reinforcement"
}

Rules:
- result must be one of: "correct", "partly_correct", "incorrect"
- ${coachingRule}
- feedback must be informative.
- helpfulCorrection must add value, not repeat the same sentence.
- This is for ALL subjects.
- Do not assume law-specific framing.
- Return JSON only.
`;

  const content = await callGroq(
    [
      {
        role: "system",
        content: "You are a strict answer-checking assistant that returns JSON only."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    TEXT_MODEL,
    0.1
  );

  const parsed = extractJson(content);

  return {
    result:
      parsed?.result === "correct" || parsed?.result === "partly_correct" || parsed?.result === "incorrect"
        ? parsed.result
        : "partly_correct",
    title: parsed?.title || "Helpful feedback",
    feedback: parsed?.feedback || "Here is some feedback on your answer.",
    helpfulCorrection:
      parsed?.helpfulCorrection || "Review the main explanation and example for the exact idea."
  };
}

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        message: "No file uploaded"
      });
    }

    const profile = {
      subject: req.body.subject,
      level: req.body.level,
      learningStyle: req.body.learningStyle
    };

    const extracted = await extractTextFromFile(req.file.path, req.file.mimetype);
    const extractedText = extracted.fullText;
    const chunks = buildLessonPackageFromSourceText(extracted);

     console.log("CHUNK COUNT:", chunks.length);
     console.log(
    "CHUNKS PREVIEW:",
    chunks.map((c, i) => ({
      index: i,
      preview: c.slice(0, 180)
    }))
   );

    if (!chunks.length) {
      return res.status(400).json({
        ok: false,
        message: "Could not extract enough usable text from that file."
      });
    }

    const { sessionIntro, roadmap } = await generateSessionRoadmap(chunks, profile);
    const lesson = await generateLessonFromChunk(chunks[0], profile, 0, roadmap);

    res.json({
      ok: true,
      message: "File uploaded and first lesson generated",
      file: {
        originalName: req.file.originalname,
        savedName: req.file.filename,
        mimetype: req.file.mimetype,
        size: req.file.size
      },
      extractedText,
      chunks,
      chunkCount: chunks.length,
      currentChunkIndex: 0,
      sessionIntro,
      roadmap,
      lesson
    });
  } catch (error) {
    console.error("Upload/process error:", error);
    res.status(500).json({
      ok: false,
      message: error.message || "Failed to process file"
    });
  }
});

app.post("/next-chunk", async (req, res) => {
  try {
    const {
      chunks,
      nextChunkIndex,
      subject,
      level,
      learningStyle,
      roadmap,
      previousLesson
    } = req.body;

    if (!Array.isArray(chunks) || typeof nextChunkIndex !== "number") {
      return res.status(400).json({
        ok: false,
        message: "chunks array and nextChunkIndex are required"
      });
    }

    if (nextChunkIndex < 0 || nextChunkIndex >= chunks.length) {
      return res.json({
        ok: true,
        done: true,
        message: "No more chunks left"
      });
    }

    const lesson = await generateLessonFromChunk(
      chunks[nextChunkIndex],
      { subject, level, learningStyle },
      nextChunkIndex,
      Array.isArray(roadmap) ? roadmap : [],
      {
        chunkText: nextChunkIndex > 0 ? chunks[nextChunkIndex - 1] : "",
        explanation: previousLesson?.explanation || ""
      }
    );

    res.json({
      ok: true,
      done: false,
      currentChunkIndex: nextChunkIndex,
      lesson
    });
  } catch (error) {
    console.error("Next chunk error:", error);
    res.status(500).json({
      ok: false,
      message: error.message || "Failed to generate next chunk"
    });
  }
});

app.post("/retry-chunk", async (req, res) => {
  try {
    const {
      chunk,
      chunkIndex,
      roadmap,
      subject,
      level,
      learningStyle
    } = req.body;

    if (!chunk) {
      return res.status(400).json({
        ok: false,
        message: "chunk is required"
      });
    }

    const lesson = await simplifyLessonFromChunk(
      chunk,
      { subject, level, learningStyle },
      typeof chunkIndex === "number" ? chunkIndex : 0,
      Array.isArray(roadmap) ? roadmap : []
    );

    res.json({
      ok: true,
      lesson
    });
  } catch (error) {
    console.error("Retry chunk error:", error);
    res.status(500).json({
      ok: false,
      message: error.message || "Failed to simplify chunk"
    });
  }
});

app.post("/check-answer", async (req, res) => {
  try {
    const { lesson, studentAnswer, learningStyle } = req.body;

    if (!lesson || !studentAnswer) {
      return res.status(400).json({
        ok: false,
        message: "lesson and studentAnswer are required"
      });
    }

    const result = await checkStudentAnswer({
      lesson,
      studentAnswer,
      learningStyle
    });

    res.json({
      ok: true,
      result
    });
  } catch (error) {
    console.error("Answer check error:", error);
    res.status(500).json({
      ok: false,
      message: error.message || "Failed to check answer"
    });
  }
});

app.use(express.static(path.join(__dirname, "..", "frontend")));

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Learna backend running on http://localhost:${PORT}`);
});