const views = {
  hero: document.getElementById("view-hero"),
  upload: document.getElementById("view-upload"),
  loading: document.getElementById("view-loading"),
  lesson: document.getElementById("view-lesson")
};

const startBtn = document.getElementById("startBtn");
const backBtn = document.getElementById("backBtn");
const lessonBackBtn = document.getElementById("lessonBackBtn");
const processBtn = document.getElementById("processBtn");
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");

const subjectSelect = document.getElementById("subjectSelect");
const levelSelect = document.getElementById("levelSelect");
const styleSelect = document.getElementById("styleSelect");

const sessionIntroBanner = document.getElementById("sessionIntroBanner");
const introTitle = document.getElementById("introTitle");
const introSubtitle = document.getElementById("introSubtitle");
const roadmapList = document.getElementById("roadmapList");

const lessonLabel = document.getElementById("lessonLabel");
const lessonTitle = document.getElementById("lessonTitle");
const lessonGoal = document.getElementById("lessonGoal");
const explanationText = document.getElementById("explanationText");
const annotationWrap = document.getElementById("annotationWrap");
const annotationText = document.getElementById("annotationText");
const exampleBox = document.getElementById("exampleBox");
const exampleLabel = document.getElementById("exampleLabel");
const exampleText = document.getElementById("exampleText");
const marginNote = document.getElementById("marginNote");
const microRecapText = document.getElementById("microRecapText");
const diagramBox = document.getElementById("diagramBox");
const progressNodes = Array.from(document.querySelectorAll(".path-node"));

const quizQuestion = document.getElementById("quizQuestion");
const quizOpts = document.getElementById("quizOpts");
const fb = document.getElementById("fb");
const fbIco = document.getElementById("fbIco");
const fbT = document.getElementById("fbT");
const fbD = document.getElementById("fbD");
const fbExtra = document.getElementById("fbExtra");
const quizNext = document.getElementById("quizNext");

const statScore = document.getElementById("statScore");
const statProgress = document.getElementById("statProgress");
const takeawayText = document.getElementById("takeawayText");
const summaryBullets = document.getElementById("summaryBullets");
const whyText = document.getElementById("whyText");
const nextTeaserTitle = document.getElementById("nextTeaserTitle");
const nextNum = document.getElementById("nextNum");

const beginLessonBtn = document.getElementById("beginLessonBtn");
const toQuizBtn = document.getElementById("toQuizBtn");
const retryBtn = document.getElementById("retryBtn");
const toSummaryBtn = document.getElementById("toSummaryBtn");
const nextChunkBtn = document.getElementById("nextChunkBtn");
const restartChunkBtn = document.getElementById("restartChunkBtn");

let selectedFile = null;
let allChunks = [];
let currentChunkIndex = 0;
let currentLesson = null;
let sessionIntro = "";
let roadmap = [];
let wasCorrect = false;

function showView(name) {
  Object.values(views).forEach((view) => view.classList.add("hidden"));
  views[name].classList.remove("hidden");
}

function goTo(step) {
  document.querySelectorAll(".chunk").forEach((chunk) => chunk.classList.remove("active"));
  const current = document.getElementById(`chunk-${step}`);
  if (current) current.classList.add("active");

  for (let i = 1; i <= 4; i += 1) {
    const node = document.getElementById(`node${i}`);
    node.classList.remove("active", "done");
    if (i < step) node.classList.add("done");
    else if (i === step) node.classList.add("active");
  }

  for (let i = 1; i <= 3; i += 1) {
    const fill = document.getElementById(`line${i}`);
    fill.style.width = i < step ? "100%" : "0%";
  }

  if (step === 4) {
    statScore.textContent = wasCorrect ? "100%" : "0%";
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function buildRoadmapHTML(items, activeIndex = 0) {
  if (!Array.isArray(items) || !items.length) return "";

  return `
    <ul class="roadmap">
      ${items.map((item, index) => `
        <li class="${index > activeIndex ? "dim" : ""}">
          <div class="num ${index === activeIndex ? "now" : "later"}">${index + 1}</div>
          <div class="info">
            <h3>${escapeHtml(item)}</h3>
            <p>${index === activeIndex ? "Current lesson part" : "Coming next"}</p>
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function renderTeachingBreakdown(lesson) {
  const breakdown = lesson?.teachingBreakdown;

  if (!breakdown || typeof breakdown !== "object") {
    explanationText.innerHTML = `
      <div class="explanation-fallback">${escapeHtml(lesson?.explanation || "")}</div>
    `;
    return;
  }

  const sections = [
    {
      title: "This is the concept",
      text: breakdown.concept || ""
    },
    {
      title: "This is the key thing to notice",
      text: breakdown.keyNotice || ""
    },
    {
      title: "This is how it works",
      text: breakdown.howItWorks || ""
    },
    {
      title: "Don’t confuse it with this",
      text: breakdown.confusion || ""
    }
  ].filter((section) => section.text && section.text.trim());

  explanationText.innerHTML = sections
    .map(
      (section) => `
        <div class="teach-section">
          <div class="teach-section-title">${escapeHtml(section.title)}</div>
          <div class="teach-section-text">${escapeHtml(section.text)}</div>
        </div>
      `
    )
    .join("");
}

function renderDiagram(diagram) {
  if (!diagram || !diagram.type || diagram.type === "none") {
    diagramBox.classList.add("hidden");
    diagramBox.innerHTML = "";
    return;
  }

  let html = "";

  if (diagram.type === "compare") {
    html = `
      <div class="diagram-title">${escapeHtml(diagram.title || "Comparison")}</div>
      <div class="diagram-compare">
        <div class="diagram-compare-card">
          <div class="diagram-compare-title">${escapeHtml(diagram.leftTitle || "")}</div>
          <div class="diagram-compare-body">${escapeHtml(diagram.leftBody || "")}</div>
        </div>
        <div class="diagram-compare-card">
          <div class="diagram-compare-title">${escapeHtml(diagram.rightTitle || "")}</div>
          <div class="diagram-compare-body">${escapeHtml(diagram.rightBody || "")}</div>
        </div>
      </div>
    `;
  } else if (diagram.type === "beforeAfter") {
    html = `
      <div class="diagram-title">${escapeHtml(diagram.title || "Before and after")}</div>
      <div class="diagram-before-after">
        <div class="diagram-transform-card">
          <div class="diagram-transform-label">${escapeHtml(diagram.beforeLabel || "Before")}</div>
          <div class="diagram-transform-value">${escapeHtml(diagram.beforeValue || "")}</div>
        </div>
        <div class="diagram-arrow">→</div>
        <div class="diagram-transform-card active">
          <div class="diagram-transform-label">${escapeHtml(diagram.afterLabel || "After")}</div>
          <div class="diagram-transform-value">${escapeHtml(diagram.afterValue || "")}</div>
        </div>
      </div>
    `;
  } else if (diagram.type === "steps") {
    const steps = Array.isArray(diagram.steps) ? diagram.steps : [];
    html = `
      <div class="diagram-title">${escapeHtml(diagram.title || "Steps")}</div>
      <div class="diagram-flow">
        ${steps.map((step, index) => `
          <div class="diagram-node ${index === steps.length - 1 ? "active" : ""}">${escapeHtml(step)}</div>
          ${index < steps.length - 1 ? `<div class="diagram-arrow">→</div>` : ""}
        `).join("")}
      </div>
    `;
  } else if (diagram.type === "formula") {
    html = `
      <div class="diagram-title">${escapeHtml(diagram.title || "Formula")}</div>
      <div class="diagram-formula-card">
        <div class="diagram-formula-main">${escapeHtml(diagram.formula || "")}</div>
      </div>
    `;
  }

  diagramBox.innerHTML = html;
  diagramBox.classList.remove("hidden");
}

function renderQuiz(lesson) {
  const quiz = lesson.quiz || {};
  quizQuestion.textContent = quiz.question || "Question unavailable.";
  quizOpts.innerHTML = "";
  fb.className = "fb-banner";
  fbT.textContent = "";
  fbD.textContent = "";
  fbExtra.textContent = "";
  quizNext.classList.add("hidden");
  wasCorrect = false;

  const options = Array.isArray(quiz.options) ? quiz.options : [];
  options.forEach((option, index) => {
    const button = document.createElement("button");
    button.className = "qopt";
    button.innerHTML = `
      <span class="letter">${String.fromCharCode(65 + index)}</span>
      <span>${escapeHtml(option)}</span>
    `;
    button.addEventListener("click", () => handleQuizAnswer(index));
    quizOpts.appendChild(button);
  });
}

function renderSummary(lesson) {
  const summary = lesson.summary || {};

  takeawayText.textContent = summary.takeaway || "";
  whyText.textContent = summary.whyItMatters || "";
  nextTeaserTitle.textContent = summary.nextTeaser || "Next part";
  nextNum.textContent = String(currentChunkIndex + 2).padStart(2, "0");
  statProgress.textContent = `${currentChunkIndex + 1}/${allChunks.length || 1}`;

  summaryBullets.innerHTML = "";
  const bullets = Array.isArray(summary.bullets) ? summary.bullets : [];
  bullets.forEach((bullet) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="check">✓</span><span>${escapeHtml(bullet)}</span>`;
    summaryBullets.appendChild(li);
  });
}

function renderLesson(lesson) {
  currentLesson = lesson;

  sessionIntroBanner.textContent = sessionIntro || "";
  sessionIntroBanner.classList.toggle("hidden", !sessionIntro);

  introTitle.innerHTML = `The basics of <strong>${escapeHtml(lesson.topicTitle || "this topic")}</strong>`;
  introSubtitle.textContent = lesson.subtitle || "A short guided lesson from your uploaded material.";
  roadmapList.innerHTML = buildRoadmapHTML(roadmap, currentChunkIndex);

  lessonLabel.textContent = lesson.sessionLabel || `Concept ${String(currentChunkIndex + 1).padStart(2, "0")}`;
  lessonTitle.innerHTML = `${escapeHtml(lesson.topicTitle || "Topic")}`;
  lessonGoal.textContent = lesson.lessonGoal || "";
  renderTeachingBreakdown(lesson);

  if (lesson.marginNote) {
  annotationWrap.classList.remove("hidden");
  annotationText.innerHTML = `${escapeHtml(lesson.marginNote)} <span class="arrow">↓</span>`;
  marginNote.classList.add("hidden");
  } else {
  annotationWrap.classList.add("hidden");
  marginNote.classList.add("hidden");
  }

  if (lesson.exampleBox?.text) {
    exampleBox.classList.remove("hidden");
    exampleLabel.textContent = lesson.exampleBox.label || "Strong example";
    exampleText.textContent = lesson.exampleBox.text;
  } else {
    exampleBox.classList.add("hidden");
  }

  microRecapText.textContent = lesson.microRecap || "";
  renderDiagram(lesson.diagram);
  renderQuiz(lesson);
  renderSummary(lesson);
  goTo(1);
}

async function handleQuizAnswer(selectedIndex) {
  const buttons = Array.from(document.querySelectorAll(".qopt"));
  buttons.forEach((button) => button.classList.add("locked"));

  try {
    const response = await fetch("/check-answer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        lesson: currentLesson,
        studentAnswer: currentLesson.quiz.options[selectedIndex],
        learningStyle: styleSelect.value
      })
    });

    const data = await response.json();

    if (!data.ok) throw new Error(data.message || "Answer check failed");

    const result = data.result;
    const correctIndex = currentLesson.quiz.correctIndex;
    wasCorrect = result.result === "correct";

    buttons.forEach((button, index) => {
      if (index === correctIndex) {
        button.classList.add("correct");
      } else if (index === selectedIndex && index !== correctIndex) {
        button.classList.add("wrong");
      } else {
        button.classList.add("faded");
      }
    });

    fb.className = `fb-banner show ${result.result === "correct" ? "ok" : "nope"}`;
    fbIco.textContent = result.result === "correct" ? "✓" : "✕";
    fbT.textContent = result.title || "Helpful feedback";
    fbD.textContent = result.feedback || "";
    fbExtra.textContent = result.helpfulCorrection || "";

    quizNext.classList.remove("hidden");
  } catch (error) {
    console.error(error);
    fb.className = "fb-banner show nope";
    fbIco.textContent = "✕";
    fbT.textContent = "Could not check answer";
    fbD.textContent = error.message || "Something went wrong.";
    fbExtra.textContent = "";
    quizNext.classList.remove("hidden");
  }
}

async function loadUpload() {
  if (!selectedFile) return;

  showView("loading");

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("subject", subjectSelect.value);
  formData.append("level", levelSelect.value);
  formData.append("learningStyle", styleSelect.value);

  try {
    const response = await fetch("/upload", {
      method: "POST",
      body: formData
    });

    const data = await response.json();
    if (!data.ok) throw new Error(data.message || "Upload failed");

    allChunks = data.chunks || [];
    currentChunkIndex = data.currentChunkIndex || 0;
    sessionIntro = data.sessionIntro || "";
    roadmap = Array.isArray(data.roadmap) ? data.roadmap : [];

    showView("lesson");
    renderLesson(data.lesson);
  } catch (error) {
    console.error(error);
    alert(error.message || "Upload failed.");
    showView("upload");
  }
}

async function retryCurrentChunk() {
  if (!allChunks[currentChunkIndex]) return;

  try {
    const response = await fetch("/retry-chunk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chunk: allChunks[currentChunkIndex],
        chunkIndex: currentChunkIndex,
        roadmap,
        subject: subjectSelect.value,
        level: levelSelect.value,
        learningStyle: styleSelect.value
      })
    });

    const data = await response.json();
    if (!data.ok) throw new Error(data.message || "Retry failed");

    renderLesson(data.lesson);
    goTo(2);
  } catch (error) {
    console.error(error);
    alert(error.message || "Could not retry this lesson.");
  }
}

async function loadNextChunk() {
  const nextChunkIndex = currentChunkIndex + 1;

  try {
    const response = await fetch("/next-chunk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chunks: allChunks,
        nextChunkIndex,
        subject: subjectSelect.value,
        level: levelSelect.value,
        learningStyle: styleSelect.value,
        roadmap,
        previousLesson: currentLesson
      })
    });

    const data = await response.json();
    if (!data.ok) throw new Error(data.message || "Could not load next part");

    if (data.done) {
      alert("You reached the end of the uploaded lesson.");
      return;
    }

    currentChunkIndex = data.currentChunkIndex;
    renderLesson(data.lesson);
  } catch (error) {
    console.error(error);
    alert(error.message || "Could not load next chunk.");
  }
}

function restartCurrentChunk() {
  if (!currentLesson) return;
  renderLesson(currentLesson);
}

startBtn.addEventListener("click", () => showView("upload"));
backBtn.addEventListener("click", () => showView("hero"));
lessonBackBtn.addEventListener("click", () => {
  if (!currentLesson) return;
  showView("lesson");
  goTo(1);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;

  selectedFile = file;
  fileName.textContent = `Selected: ${file.name}`;
  fileName.classList.remove("hidden");
  processBtn.disabled = false;
});

progressNodes.forEach((node, index) => {
  node.addEventListener("click", () => {
    if (!currentLesson) return;
    goTo(index + 1);
  });
});

processBtn.addEventListener("click", loadUpload);
beginLessonBtn.addEventListener("click", () => goTo(2));
toQuizBtn.addEventListener("click", () => goTo(3));
retryBtn.addEventListener("click", retryCurrentChunk);
toSummaryBtn.addEventListener("click", () => goTo(4));
nextChunkBtn.addEventListener("click", loadNextChunk);
restartChunkBtn.addEventListener("click", restartCurrentChunk);

showView("hero");