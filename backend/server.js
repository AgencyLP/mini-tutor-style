const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");


const app = express();
const PORT = process.env.PORT || 3000;

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const TEXT_MODEL = "openai/gpt-oss-120b";
const LESSON_RESPONSE_SCHEMA = {
  name: "lesson_card",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sessionLabel: { type: "string" },
      topicTitle: { type: "string" },
      subtitle: { type: "string" },
      lessonGoal: { type: "string" },
      teachingBreakdown: {
        type: "object",
        additionalProperties: false,
        properties: {
          concept: { type: "string" },
          keyNotice: { type: "string" },
          howItWorks: { type: "string" },
          confusion: { type: "string" }
        },
        required: ["concept", "keyNotice", "howItWorks", "confusion"]
      },
      explanation: { type: "string" },
      exampleBox: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          text: { type: "string" }
        },
        required: ["label", "text"]
      },
      marginNote: { type: "string" },
      microRecap: { type: "string" },
      diagram: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          title: { type: "string" },
          leftTitle: { type: "string" },
          leftBody: { type: "string" },
          rightTitle: { type: "string" },
          rightBody: { type: "string" },
          beforeLabel: { type: "string" },
          beforeValue: { type: "string" },
          afterLabel: { type: "string" },
          afterValue: { type: "string" },
          steps: {
            type: "array",
            items: { type: "string" }
          },
          formula: { type: "string" }
        },
        required: [
          "type",
          "title",
          "leftTitle",
          "leftBody",
          "rightTitle",
          "rightBody",
          "beforeLabel",
          "beforeValue",
          "afterLabel",
          "afterValue",
          "steps",
          "formula"
        ]
      },
      quiz: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          options: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: { type: "string" }
          },
          correctIndex: { type: "integer" },
          correctExplanation: { type: "string" },
          wrongExplanation: { type: "string" }
        },
        required: [
          "question",
          "options",
          "correctIndex",
          "correctExplanation",
          "wrongExplanation"
        ]
      },
      summary: {
        type: "object",
        additionalProperties: false,
        properties: {
          takeaway: { type: "string" },
          bullets: {
            type: "array",
            items: { type: "string" }
          },
          whyItMatters: { type: "string" },
          nextTeaser: { type: "string" }
        },
        required: ["takeaway", "bullets", "whyItMatters", "nextTeaser"]
      }
    },
    required: [
      "sessionLabel",
      "topicTitle",
      "subtitle",
      "lessonGoal",
      "teachingBreakdown",
      "explanation",
      "exampleBox",
      "marginNote",
      "microRecap",
      "diagram",
      "quiz",
      "summary"
    ]
  }
};

const ROADMAP_RESPONSE_SCHEMA = {
  name: "lesson_roadmap",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sessionIntro: { type: "string" },
      roadmap: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["sessionIntro", "roadmap"]
  }
};

const EXTRACTION_RESPONSE_SCHEMA = {
  name: "chunk_teaching_units",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mainTopic: { type: "string" },
      chunkType: { type: "string" },
      namedAnchors: {
        type: "array",
        items: { type: "string" }
      },
      definitions: {
        type: "array",
        items: { type: "string" }
      },
      keyFacts: {
        type: "array",
        items: { type: "string" }
      },
      listItems: {
        type: "array",
        items: { type: "string" }
      },
      distinctions: {
        type: "array",
        items: { type: "string" }
      },
      formulas: {
        type: "array",
        items: { type: "string" }
      },
      workedExamples: {
        type: "array",
        items: { type: "string" }
      },
      sourceQuestions: {
        type: "array",
        items: { type: "string" }
      },
      importantPhrases: {
        type: "array",
        items: { type: "string" }
      },
      mustCover: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["mainTopic", "chunkType"]
  }
};

const TEACHING_PLAN_RESPONSE_SCHEMA = {
  name: "chunk_teaching_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      lessonFocus: { type: "string" },
      mustTeachFirst: { type: "string" },
      mustMention: {
        type: "array",
        items: { type: "string" }
      },
      teachOrder: {
        type: "array",
        items: { type: "string" }
      },
      preserveTerms: {
        type: "array",
        items: { type: "string" }
      },
      preserveFormula: { type: "string" },
      chosenExample: { type: "string" },
      mainConfusion: { type: "string" },
      chunkRole: { type: "string" }
    },
    required: [
      "lessonFocus",
      "mustTeachFirst",
      "mustMention",
      "teachOrder",
      "preserveTerms",
      "preserveFormula",
      "chosenExample",
      "mainConfusion",
      "chunkRole"
    ]
  }
};

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

async function callGroqStructured(messages, jsonSchema, model = TEXT_MODEL, temperature = 0.2) {
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
      messages,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: jsonSchema.name,
          schema: jsonSchema.schema,
          strict: true
        }
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || "Groq structured request failed");
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string" || !content.trim()) {
    console.error("EMPTY STRUCTURED GROQ RESPONSE:", JSON.stringify(data, null, 2));
    throw new Error("Groq returned an empty structured response");
  }

  return JSON.parse(content);
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

function normalizeMathText(text) {
  return String(text || "")
    .replace(/[−–—]/g, "-")
    .replace(/[×✕]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/[≠]/g, "!=")
    .replace(/[≈]/g, "~=")
    .replace(/[∑]/g, "sum")
    .replace(/[√]/g, "sqrt")
    .replace(/[π]/g, "pi")
    .replace(/[∞]/g, "infinity")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function containsHangul(text) {
  return /[\u3131-\u318E\uAC00-\uD7A3]/.test(String(text || ""));
}

function sanitizeLessonStrings(value, options = {}) {
  const { mathMode = false } = options;

  if (typeof value === "string") {
    let cleaned = value.trim();

    if (mathMode) {
      cleaned = normalizeMathText(cleaned);
    }

    if (containsHangul(cleaned)) {
      cleaned = cleaned
        .replace(/[\u3131-\u318E\uAC00-\uD7A3]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    return cleaned;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLessonStrings(item, options));
  }

  if (value && typeof value === "object") {
    const result = {};

    for (const [key, item] of Object.entries(value)) {
      const childMathMode =
        mathMode || key === "formula" || key.toLowerCase().includes("equation");

      result[key] = sanitizeLessonStrings(item, { mathMode: childMathMode });
    }

    return result;
  }

  return value;
}

function sanitizeChunkForPrompt(chunk) {
  let cleaned = normalizeMathText(chunk)
    .replace(/[\u3131-\u318E\uAC00-\uD7A3]/g, " ")
    .replace(/[′’]/g, "'")
    .replace(/[•●▪]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const looksFormulaHeavy =
    (cleaned.match(/[=+\-*/%]/g) || []).length >= 2 ||
    /\bformula\b|\bdividend\b|\btax credit\b|\brate\b/i.test(cleaned);

  if (looksFormulaHeavy) {
    cleaned = cleaned
      .replace(/\b([A-Za-z])\s+'?\s+s\b/g, "$1's")
      .replace(/\bcompany\s+'?\s+s\b/gi, "company's")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return cleaned;
}

function normalizeTeachingBreakdown(raw = {}, fallbackText = "") {
  const fallback = String(fallbackText || "").trim();

  return {
    concept:
      typeof raw?.concept === "string" && raw.concept.trim()
        ? raw.concept.trim()
        : fallback,
    keyNotice:
      typeof raw?.keyNotice === "string" && raw.keyNotice.trim()
        ? raw.keyNotice.trim()
        : "Focus on the main point and what the material is really trying to emphasize.",
    howItWorks:
      typeof raw?.howItWorks === "string" && raw.howItWorks.trim()
        ? raw.howItWorks.trim()
        : "Follow how the rule, process, or idea is being applied in this section.",
    confusion:
      typeof raw?.confusion === "string" && raw.confusion.trim()
        ? raw.confusion.trim()
        : "Be careful not to mix this concept up with a related term unless the chunk clearly makes that distinction."
  };
}

function flattenTeachingBreakdown(breakdown = {}) {
  return [
    breakdown?.concept,
    breakdown?.keyNotice,
    breakdown?.howItWorks,
    breakdown?.confusion
  ]
    .filter((item) => typeof item === "string" && item.trim())
    .join(" ");
}

function normalizeExtractedTeachingUnits(raw = {}) {
  const cleanList = (value, limit = 8) =>
    Array.isArray(value)
      ? value
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => item.trim())
          .slice(0, limit)
      : [];

  return {
    mainTopic:
      typeof raw?.mainTopic === "string" && raw.mainTopic.trim()
        ? raw.mainTopic.trim()
        : "Untitled topic",
    chunkType:
      typeof raw?.chunkType === "string" && raw.chunkType.trim()
        ? raw.chunkType.trim()
        : "mixed",
    namedAnchors: cleanList(raw?.namedAnchors, 8),
    definitions: cleanList(raw?.definitions, 4),
    keyFacts: cleanList(raw?.keyFacts, 8),
    listItems: cleanList(raw?.listItems, 10),
    distinctions: cleanList(raw?.distinctions, 6),
    formulas: cleanList(raw?.formulas, 4),
    workedExamples: cleanList(raw?.workedExamples, 4),
    sourceQuestions: cleanList(raw?.sourceQuestions, 4),
    importantPhrases: cleanList(raw?.importantPhrases, 8),
    mustCover: cleanList(raw?.mustCover, 8)
  };
}

function normalizeTeachingPlan(raw = {}, fallback = {}) {
  const cleanList = (value, limit = 8) =>
    Array.isArray(value)
      ? value
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => item.trim())
          .slice(0, limit)
      : [];

  return {
    lessonFocus:
      typeof raw?.lessonFocus === "string" && raw.lessonFocus.trim()
        ? raw.lessonFocus.trim()
        : fallback?.mainTopic || "Main idea of the chunk",
    mustTeachFirst:
      typeof raw?.mustTeachFirst === "string" && raw.mustTeachFirst.trim()
        ? raw.mustTeachFirst.trim()
        : fallback?.mainTopic || "Main idea of the chunk",
    mustMention: cleanList(raw?.mustMention, 8),
    teachOrder: cleanList(raw?.teachOrder, 8),
    preserveTerms: cleanList(raw?.preserveTerms, 8),
    preserveFormula:
      typeof raw?.preserveFormula === "string" ? raw.preserveFormula.trim() : "",
    chosenExample:
      typeof raw?.chosenExample === "string" ? raw.chosenExample.trim() : "",
    mainConfusion:
      typeof raw?.mainConfusion === "string" && raw.mainConfusion.trim()
        ? raw.mainConfusion.trim()
        : "",
    chunkRole:
      typeof raw?.chunkRole === "string" && raw.chunkRole.trim()
        ? raw.chunkRole.trim()
        : fallback?.chunkType || "mixed"
  };
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
    teachingBreakdown: {
      concept: "The file text was extracted successfully, but this chunk still needs a cleaner AI explanation.",
      keyNotice: "This section loaded, but the tutor could not yet turn it into a strong guided lesson.",
      howItWorks: "The upload and chunking worked, but the AI teaching output for this chunk still needs improvement.",
      confusion: "Do not treat this fallback lesson as the final explanation of the source material."
   },
   explanation: "The file text was extracted successfully, but this chunk still needs a cleaner AI explanation.",
    exampleBox: {
      label: "Extracted preview",
      text: sanitizeChunkForPrompt(chunk).slice(0, 220)
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
    const parsed = await callGroqStructured(
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
      ROADMAP_RESPONSE_SCHEMA,
      TEXT_MODEL,
      0.1
     );

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

async function extractChunkTeachingUnits(chunk, profile = {}, extra = {}) {
  if (!GROQ_API_KEY) {
    return normalizeExtractedTeachingUnits({
      mainTopic: extra?.roadmapTitle || "Untitled topic",
      chunkType: extra?.isOverviewChunk ? "overview" : extra?.chunkLooksCalculationHeavy ? "formula" : "mixed",
      namedAnchors: [],
      definitions: [],
      keyFacts: [],
      listItems: [],
      distinctions: [],
      formulas: [],
      workedExamples: [],
      sourceQuestions: [],
      importantPhrases: [],
      mustCover: []
    });
  }

 const prompt = `
You are extracting teaching material from one study chunk.

Use only the source chunk.
Do not explain it.
Do not summarize it.
Do not teach it.
Do not add outside knowledge.

Chunk:
${chunk}

Return JSON only in the exact schema provided.

Extraction rules:
- mainTopic = short main topic of the chunk.
- chunkType = one of: overview, definition, list, distinction, formula, worked_example, mixed.
- namedAnchors = named sections, laws, theories, models, frameworks, or formal labels.
- definitions = formal definitions stated in the chunk.
- keyFacts = the most important factual statements in the chunk.
- listItems = numbered or bulleted items, categories, components, or stages.
- distinctions = any contrast or X-vs-Y idea.
- formulas = formulas or symbolic rules copied as faithfully as possible.
- workedExamples = examples or numeric setups already present in the chunk.
- sourceQuestions = questions explicitly asked in the source.
- importantPhrases = exact formal phrases worth preserving.
- mustCover = the most important 2 to 6 items that should not be skipped in the lesson.

Keep it simple and source-faithful.
If something is absent, return an empty array.
`;

  const rawParsed = await callGroqStructured(
    [
      {
        role: "system",
        content: "You extract teaching units from a source chunk and return one strict JSON object only."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    EXTRACTION_RESPONSE_SCHEMA,
    TEXT_MODEL,
    0.1
  );

  const parsed = normalizeExtractedTeachingUnits(rawParsed);
  console.log("EXTRACTED TEACHING UNITS:\n", JSON.stringify(parsed, null, 2));
  return parsed;
}

async function organizeTeachingPlan(chunk, extractedUnits, profile = {}) {
  if (!GROQ_API_KEY) {
    return normalizeTeachingPlan(
      {
        lessonFocus: extractedUnits?.mainTopic || "Main idea of the chunk",
        mustTeachFirst: extractedUnits?.mainTopic || "Main idea of the chunk",
        mustMention: extractedUnits?.mustCover || [],
        teachOrder: [
          extractedUnits?.mainTopic || "Main topic",
          ...(extractedUnits?.definitions || []).slice(0, 2),
          ...(extractedUnits?.listItems || []).slice(0, 3),
          ...(extractedUnits?.distinctions || []).slice(0, 2)
        ].filter(Boolean),
        preserveTerms: [
          ...(extractedUnits?.namedAnchors || []),
          ...(extractedUnits?.importantPhrases || [])
        ].slice(0, 8),
        preserveFormula: extractedUnits?.formulas?.[0] || "",
        chosenExample: extractedUnits?.workedExamples?.[0] || "",
        mainConfusion: extractedUnits?.distinctions?.[0] || "",
        chunkRole: extractedUnits?.chunkType || "mixed"
      },
      extractedUnits
    );
  }

  const prompt = `
You are organizing extracted source material into a teaching plan.

${buildTutorContext(profile)}

Use only the source chunk and extracted teaching units.
Do not teach yet.
Do not write tutor prose yet.
Do not add outside knowledge.

Source chunk:
${chunk}

Extracted teaching units:
- Main topic: ${extractedUnits.mainTopic}
- Chunk type: ${extractedUnits.chunkType}
- Named anchors: ${extractedUnits.namedAnchors.join(" | ") || "None"}
- Definitions: ${extractedUnits.definitions.join(" | ") || "None"}
- Key facts: ${extractedUnits.keyFacts.join(" | ") || "None"}
- List items: ${extractedUnits.listItems.join(" | ") || "None"}
- Distinctions: ${extractedUnits.distinctions.join(" | ") || "None"}
- Formulas: ${extractedUnits.formulas.join(" | ") || "None"}
- Worked examples: ${extractedUnits.workedExamples.join(" | ") || "None"}
- Source questions: ${extractedUnits.sourceQuestions.join(" | ") || "None"}
- Important phrases: ${extractedUnits.importantPhrases.join(" | ") || "None"}
- Must-cover items: ${extractedUnits.mustCover.join(" | ") || "None"}

Return JSON only in the exact schema provided.

Planning rules:
- lessonFocus = the overall focus of the lesson.
- mustTeachFirst = the first thing the student must understand.
- mustMention = the specific items that must be explicitly covered.
- teachOrder = the best order to teach the chunk coherently.
- preserveTerms = exact terms or labels that should be kept for accuracy.
- preserveFormula = the exact formula to preserve, if any.
- chosenExample = the best source-anchored example to use.
- mainConfusion = the most likely misunderstanding to address.
- chunkRole = one of: overview, definition, list, distinction, formula, worked_example, mixed.

Important:
- Prefer source-faithful organization over a smooth but vague plan.
- If a named anchor like a section, theory, or formal label appears, it should usually appear in mustMention or preserveTerms.
- If a formula appears, preserveFormula should copy it as faithfully as possible.
- If a list appears, teachOrder should make room for the key list items.
- If a distinction appears, mainConfusion should usually use it.
`;

  const rawParsed = await callGroqStructured(
    [
      {
        role: "system",
        content: "You organize extracted teaching material into a lesson plan and return one strict JSON object only."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    TEACHING_PLAN_RESPONSE_SCHEMA,
    TEXT_MODEL,
    0.1
  );

  const parsed = normalizeTeachingPlan(rawParsed, extractedUnits);
  console.log("STEP 2 TEACHING PLAN:\n", JSON.stringify(parsed, null, 2));
  return parsed;
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
  const safeChunk = sanitizeChunkForPrompt(chunk);
  const previousLessonSummary = sanitizeChunkForPrompt(previousContext?.explanation || "");
  const previousChunkText = sanitizeChunkForPrompt(previousContext?.chunkText || "");
  const roadmapTitle = roadmap?.[chunkIndex] || `Part ${chunkIndex + 1}`;
  const nextRoadmapTitle = roadmap?.[chunkIndex + 1] || "";
  const chunkLooksCalculationHeavy = looksCalculationHeavy(chunk);
  const isOverviewChunk =
  /^\s*(overview|introduction|summary|outline)\b/i.test(chunk) ||
  ((chunk.match(/\b(?:1\.|2\.|3\.|4\.|5\.)/g) || []).length >= 4 &&
   chunk.length < 900);
  let extractedUnits;

  try {
    extractedUnits = await extractChunkTeachingUnits(safeChunk, profile, {
      roadmapTitle,
      isOverviewChunk,
      chunkLooksCalculationHeavy
    });
  } catch (error) {
    console.warn("STEP 1 EXTRACTION FAILED, CONTINUING WITHOUT IT:", error.message);

    extractedUnits = normalizeExtractedTeachingUnits({
      mainTopic: roadmapTitle,
      chunkType: isOverviewChunk ? "overview" : chunkLooksCalculationHeavy ? "formula" : "mixed",
      namedAnchors: [],
      definitions: [],
      keyFacts: [],
      listItems: [],
      distinctions: [],
      formulas: [],
      workedExamples: [],
      sourceQuestions: [],
      importantPhrases: [],
      mustCover: []
    });
 }


 let teachingPlan;

try {
  teachingPlan = await organizeTeachingPlan(safeChunk, extractedUnits, profile);
} catch (error) {
  console.warn("STEP 2 TEACHING PLAN FAILED, CONTINUING WITH EXTRACTION ONLY:", error.message);

  teachingPlan = normalizeTeachingPlan(
    {
      lessonFocus: extractedUnits.mainTopic,
      mustTeachFirst: extractedUnits.mainTopic,
      mustMention: extractedUnits.mustCover,
      teachOrder: [
        extractedUnits.mainTopic,
        ...extractedUnits.definitions.slice(0, 2),
        ...extractedUnits.listItems.slice(0, 3),
        ...extractedUnits.distinctions.slice(0, 2)
      ].filter(Boolean),
      preserveTerms: [
        ...extractedUnits.namedAnchors,
        ...extractedUnits.importantPhrases
      ].slice(0, 8),
      preserveFormula: extractedUnits.formulas[0] || "",
      chosenExample: extractedUnits.workedExamples[0] || "",
      mainConfusion: extractedUnits.distinctions[0] || "",
      chunkRole: extractedUnits.chunkType
    },
    extractedUnits
  );
}

  const prompt = `
You are an AI tutor creating one lesson card for a student.

${tutorContext}

Use only the uploaded source chunk as the truth.
Do not add outside textbook knowledge.
Do not assume the subject is law unless the chunk is clearly about law.

Your job is not just to summarize.
Your job is to TEACH the material in the chunk clearly, faithfully, and in a coherent order.

Current chunk:
${safeChunk}

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

Extracted teaching units:
- Main topic: ${extractedUnits.mainTopic}
- Chunk type: ${extractedUnits.chunkType}
- Named anchors: ${extractedUnits.namedAnchors.join(" | ") || "None"}
- Definitions: ${extractedUnits.definitions.join(" | ") || "None"}
- Key facts: ${extractedUnits.keyFacts.join(" | ") || "None"}
- List items: ${extractedUnits.listItems.join(" | ") || "None"}
- Distinctions: ${extractedUnits.distinctions.join(" | ") || "None"}
- Formulas: ${extractedUnits.formulas.join(" | ") || "None"}
- Worked examples: ${extractedUnits.workedExamples.join(" | ") || "None"}
- Source questions: ${extractedUnits.sourceQuestions.join(" | ") || "None"}
- Important phrases: ${extractedUnits.importantPhrases.join(" | ") || "None"}
- Must-cover items: ${extractedUnits.mustCover.join(" | ") || "None"}
- Use these extracted teaching units as support, but always verify them against the source chunk itself.

Teaching plan:
- Must teach first: ${teachingPlan.mustTeachFirst}
- Must mention: ${teachingPlan.mustMention.join(" | ") || "None"}
- Preserve terms: ${teachingPlan.preserveTerms.join(" | ") || "None"}
- Preserve formula: ${teachingPlan.preserveFormula || "None"}
- Chosen example: ${teachingPlan.chosenExample || "None"}
- Main confusion: ${teachingPlan.mainConfusion || "None"}

Before writing the lesson, identify the most relevant teaching units inside the chunk.

Relevant teaching units may include:
- named law, section, theorem, model, theory, framework, or principle
- formal definition
- numbered or bulleted list
- contrast or distinction
- formula or symbolic rule
- worked example
- explicit question asked in the source

You must make sure the lesson explicitly covers the most important teaching units that appear in the chunk.

Return JSON only in this exact shape:
{
  "sessionLabel": "Concept 01",
  "topicTitle": "Short title",
  "subtitle": "One short supporting line",
  "lessonGoal": "One short goal line",
  "teachingBreakdown": {
    "concept": "What the concept is",
    "keyNotice": "What the student should notice most",
    "howItWorks": "How the idea, rule, process, list, or formula works",
    "confusion": "What not to confuse it with"
  },
  "explanation": "One short backup explanation",
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

Rules:
- Return JSON only.
- Use only the source chunk.
- Do not invent facts not supported by the chunk.
- Teach the content, do not merely compress it.
- Prefer the extracted named anchors, list items, distinctions, formulas, important phrases, and must-cover items over a vague high-level summary.
- Use the teaching plan as guidance, but always verify it against the source chunk.
- Explicitly cover the mustMention items unless they are duplicates of each other.
- Preserve the preserveTerms items when they matter for accuracy.
- If preserveFormula is present, reproduce it faithfully before explaining it.
- Use chosenExample if it is source-faithful and clearly helpful.
- Address mainConfusion directly if it is relevant.
- explanation must feel taught, not extracted.
- You must explicitly cover the must-cover items unless they are duplicates of each other.
- Start from the most relevant teaching units in the chunk.
- If the chunk contains a named section, law, model, theorem, theory, framework, or formal source label, mention it explicitly.
- If the chunk contains a formal definition, include that definition in paraphrased tutor language without changing its meaning.
- If the chunk contains a numbered or bulleted list of important items, include the important items faithfully rather than replacing them with a vague summary.
- If the chunk contains a distinction or comparison, explain that distinction directly.
- If the chunk contains a formula, preserve the formula structure faithfully before explaining it in plain words.
- If the chunk contains a worked example, use it or explain it clearly.
- If the chunk contains an explicit question, make sure the lesson helps the student answer that question.
- If the chunk contains multiple important points, unpack them clearly instead of collapsing everything into one short line.

- teachingBreakdown.concept must clearly say what the concept is in 1 to 3 sentences.
- teachingBreakdown.keyNotice must explain the most important insight, named item, list, or distinction from the chunk in 1 to 3 sentences.
- teachingBreakdown.howItWorks must explain the mechanism, rule, process, formula, or list logic in 2 to 4 sentences.
- teachingBreakdown.confusion must explain the most likely misunderstanding in 1 to 2 sentences.
- The four teachingBreakdown fields should feel like a mini lesson, not like labels on a summary.
- Keep the four sections focused and non-repetitive, but allow enough detail to genuinely teach.
- If one section is weakly supported by the chunk, keep it careful, but do not omit strongly supported source details.

- Prefer the source's own formal terms when they matter for accuracy.
- If the source uses a precise term such as "monetary value", keep that term or explain it closely instead of replacing it with looser everyday wording.
- Simplify the teaching, but do not simplify away the source's exact meaning, terminology, examples, units, or formulas.
- When the chunk is legal, financial, economic, scientific, or otherwise technical, keep the explanation precise even when simplifying.
- Simplify wording, not meaning.
- Do not over-translate formal language into casual language if that weakens accuracy.

- Prefer examples already present in the chunk.
- Use examples in this order of priority:
  1. the exact worked example in the chunk
  2. a direct reformulation of a source example or listed item
  3. a very close source-anchored mini scenario
  4. only if necessary, a safe invented example that stays fully consistent with the chunk
- The example should help the student understand the rule in action, not just restate the concept.
- A strong example should include concrete values, facts, list items, or a mini scenario from the chunk whenever possible.
- If the chunk contains a formula and a worked example, use the worked example to show how the formula is applied.
- Do not invent new numbers, currencies, or units if the chunk already provides them.

- Never introduce a currency that does not appear in the chunk.
- If the chunk uses THB or baht, keep THB or baht.
- If the chunk gives no currency, use neutral wording like "amount" or "monetary value" instead of inventing dollars or other currencies.

- Avoid hedging words like "likely", "usually", "generally", or "often" unless the source itself is uncertain or incomplete.
- marginNote should sound like a tutor pointing out the smartest exact thing to remember.
- microRecap should prepare the student for the quiz using precise source-faithful wording.

- quiz.options must contain exactly 3 meaningful options based on the chunk.
- Do not return generic quiz options like "Option A", "Option B", or "Option C".
- If the chunk is overview-style, keep the explanation and quiz at overview level, but still surface the key listed parts.

- Output must be English only.
- Never use Korean, Japanese, Chinese, or any other non-Latin script.
- For formulas, use plain ASCII-style math only.

- If the chunk contains a formula, reproduce the formula faithfully before explaining it.
- Do not algebraically rewrite, simplify, or restate the formula unless the rewritten form is mathematically identical.
- If you are not fully sure, keep the source formula wording and notation as closely as possible.
`;

  try { 
  let rawParsed;
  try {
    rawParsed = await callGroqStructured(
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
    LESSON_RESPONSE_SCHEMA,
    TEXT_MODEL,
    0.2
  );
  } catch (error) {
  console.error("STRUCTURED FINAL LESSON CALL FAILED:", error.message);
  throw error;
  }

const parsed = sanitizeLessonStrings(rawParsed);
console.log("STRUCTURED GROQ LESSON RESPONSE:\n", JSON.stringify(parsed, null, 2));


    const safeCorrectIndex =
      typeof parsed?.quiz?.correctIndex === "number" &&
      parsed.quiz.correctIndex >= 0 &&
      parsed.quiz.correctIndex < 3
        ? parsed.quiz.correctIndex
        : 0;

    return {
      sessionLabel: parsed?.sessionLabel || `Concept ${String(chunkIndex + 1).padStart(2, "0")}`,
      topicTitle: parsed?.topicTitle || roadmapTitle,
      subtitle: parsed?.subtitle || "A short guided lesson from your uploaded material.",
      lessonGoal: parsed?.lessonGoal || "Understand the key idea in this part.",
      teachingBreakdown: normalizeTeachingBreakdown(
        parsed?.teachingBreakdown,
        parsed?.explanation || chunk.slice(0, 320)
      ),
      explanation:
        parsed?.explanation ||
        flattenTeachingBreakdown(
          normalizeTeachingBreakdown(parsed?.teachingBreakdown, chunk.slice(0, 320))
        ),
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
        correctIndex: safeCorrectIndex,
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
  console.warn("FINAL LESSON GENERATION FAILED, USING FALLBACK:", error.message);
  console.log("FAILED CHUNK:\n", chunk);
  console.log("FAILED EXTRACTED UNITS:\n", JSON.stringify(extractedUnits, null, 2));
  console.log("FAILED TEACHING PLAN:\n", JSON.stringify(teachingPlan, null, 2));
  return fallbackLesson(chunk, chunkIndex, roadmap);
}
}

async function simplifyLessonFromChunk(chunk, profile = {}, chunkIndex = 0, roadmap = []) {
  if (!GROQ_API_KEY) {
    return fallbackLesson(chunk, chunkIndex, roadmap);
  }

  const safeChunk = sanitizeChunkForPrompt(chunk);

  const prompt = `
You are simplifying a lesson for a student who needs a clearer retry explanation.

${buildTutorContext(profile)}

Use only the source chunk.
Do not add outside knowledge.

Your job is to reteach the chunk more clearly, not just shorten it.
You must still cover the most relevant teaching units in the chunk.

Chunk:
${safeChunk}

Return JSON only in this exact shape:
{
  "sessionLabel": "Concept 01",
  "topicTitle": "Short title",
  "subtitle": "One short supporting line",
  "lessonGoal": "One short goal line",
  "teachingBreakdown": {
    "concept": "What the concept is in simpler words",
    "keyNotice": "What matters most here",
    "howItWorks": "How it works simply",
    "confusion": "What not to mix it up with"
  },
  "explanation": "One short simpler explanation",
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
- Return JSON only.
- Use simpler words than before.
- Reteach the idea clearly instead of flattening it into a short summary.
- Keep the most relevant teaching units from the chunk.
- If the chunk contains a named section, definition, list, distinction, formula, worked example, or formal source label, do not skip it.
- teachingBreakdown.concept must clearly say what this is in 1 to 2 sentences.
- teachingBreakdown.keyNotice must say what matters most in 1 to 2 sentences.
- teachingBreakdown.howItWorks must explain the logic simply in 2 to 3 sentences.
- teachingBreakdown.confusion must warn about the main likely mix-up in 1 to 2 sentences.
- Keep the four sections clear and non-repetitive.

- Prefer the source's own formal terms when they matter for accuracy.
- Keep precise source wording such as named sections, formal labels, formulas, and technical terms unless simplifying them would preserve the exact same meaning.
- Simplify wording, not meaning.
- Do not replace a precise term like "monetary value" with looser wording like "dollar amount".

- Prefer an example already present in the chunk.
- Use examples in this order of priority:
  1. the exact worked example in the chunk
  2. a direct reformulation of a source example or listed item
  3. a very close source-anchored mini scenario
  4. only if necessary, a safe invented example that stays fully consistent with the chunk
- Do not invent new numbers, currencies, or units if the chunk already provides them.
- Never introduce a currency that does not appear in the chunk.
- If the chunk uses THB or baht, keep THB or baht.
- If the chunk gives no currency, use neutral wording like "amount" or "monetary value".

- Avoid hedging words like "likely", "usually", "generally", or "often" unless the source itself is uncertain or incomplete.
- Output must be English only.
- For formulas, use plain ASCII-style math only.
`;

  try {
    const rawParsed = await callGroqStructured(
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
      LESSON_RESPONSE_SCHEMA,
      TEXT_MODEL,
      0.15
     );

     const parsed = sanitizeLessonStrings(rawParsed);
     console.log("STRUCTURED RETRY LESSON RESPONSE:\n", JSON.stringify(parsed, null, 2));

    const safeCorrectIndex =
      typeof parsed?.quiz?.correctIndex === "number" &&
      parsed.quiz.correctIndex >= 0 &&
      parsed.quiz.correctIndex < 3
        ? parsed.quiz.correctIndex
        : 0;

    return {
      sessionLabel: parsed?.sessionLabel || `Concept ${String(chunkIndex + 1).padStart(2, "0")}`,
      topicTitle: parsed?.topicTitle || roadmap?.[chunkIndex] || `Part ${chunkIndex + 1}`,
      subtitle: parsed?.subtitle || "A simpler retry version of this lesson.",
      lessonGoal: parsed?.lessonGoal || "Understand the key idea more clearly.",
      teachingBreakdown: normalizeTeachingBreakdown(
        parsed?.teachingBreakdown,
        parsed?.explanation || chunk.slice(0, 280)
      ),
      explanation:
        parsed?.explanation ||
        flattenTeachingBreakdown(
          normalizeTeachingBreakdown(parsed?.teachingBreakdown, chunk.slice(0, 280))
        ),
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
                  "The simpler quiz needs regeneration",
                  "The model returned placeholder options",
                  "This chunk still needs a better retry question"
                ],
        correctIndex: safeCorrectIndex,
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