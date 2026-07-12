const fs = require("fs");

const API = "http://localhost:5000";

const TARGET_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Turkish",
  "Chinese",
  "Japanese",
  "Korean"
];

const profiles = [
  {
    label: "english-cv",
    name: "Muskan Ejaz",
    medium: "Student / Job Seeker",
    creatorType: "developer",
    description:
      "Computer Science student with hands-on experience in AI, full-stack web development, and data structures. Seeking a software engineering internship.",
    skills: [
      "Python",
      "JavaScript",
      "React",
      "Node.js",
      "MongoDB",
      "Data Structures and Algorithms",
      "Computer Networks",
      "Team Collaboration"
    ],
    projects: [
      {
        id: "p1",
        title: "Detecting Dysarthria",
        desc: "Built an AI classification model using Python, Librosa, and Scikit-learn on voice samples to identify dysarthric speech.",
        link: ""
      },
      {
        id: "p2",
        title: "Social Graph Explorer",
        desc: "Implemented BFS, DFS, and Dijkstra algorithm in C++ to manage user nodes in a social media backend simulation.",
        link: ""
      }
    ],
    customSections: [
      {
        id: "education",
        name: "Education",
        items: [
          {
            id: "e1",
            heading: "Bachelor of Computer Science",
            desc: "National University of Sciences and Technology, Islamabad. Nov 2024 – Present.",
            link: ""
          }
        ]
      },
      {
        id: "certs",
        name: "Workshops & Certifications",
        items: [
          {
            id: "c1",
            heading: "Agentic AI workshop",
            desc: "Explored AI agent architectures and LLM integration.",
            link: ""
          }
        ]
      }
    ]
  },
  {
    label: "roman-urdu-input",
    name: "Areeba Khan",
    medium: "Student / Job Seeker",
    creatorType: "developer",
    description:
      "ma web development karti hun aur React projects banati hun. ma internship ke liye apni skills improve kar rahi hun.",
    skills: ["React", "JavaScript", "HTML/CSS", "GitHub", "Problem Solving"],
    projects: [
      {
        id: "p1",
        title: "Portfolio Website",
        desc: "ma ne React aur CSS use kar ke personal portfolio website banai.",
        link: ""
      }
    ],
    customSections: [
      {
        id: "education",
        name: "Taleem",
        items: [
          {
            id: "e1",
            heading: "BS Computer Science",
            desc: "University student, software development aur AI mein interest.",
            link: ""
          }
        ]
      }
    ]
  },
  {
    label: "mixed-input",
    name: "Jordan Lee",
    medium: "Student / Job Seeker",
    creatorType: "developer",
    description:
      "Software student focused on backend development, databases, and AI projects. Completed practical labs and team projects.",
    skills: ["Python", "SQL", "Node.js", "Express.js", "REST APIs"],
    projects: [
      {
        id: "p1",
        title: "Water Monitoring App",
        desc: "Created a monitoring application for users to track water quality and report data.",
        link: ""
      }
    ],
    customSections: [
      {
        id: "experience",
        name: "Experience",
        items: [
          {
            id: "x1",
            heading: "Web Development Intern",
            desc: "Worked on frontend components and backend API integration.",
            link: ""
          }
        ]
      }
    ]
  }
];

const scriptChecks = {
  Chinese: /[\u4E00-\u9FFF]/,
  Japanese: /[\u3040-\u30FF\u4E00-\u9FFF]/,
  Korean: /[\uAC00-\uD7AF]/,
};

const languageSignals = {
  Spanish: ["el", "la", "de", "con", "para", "proyecto", "habilidades", "educación", "experiencia"],
  French: ["le", "la", "de", "avec", "pour", "projet", "compétences", "éducation", "expérience"],
  German: ["der", "die", "das", "und", "mit", "für", "projekt", "fähigkeiten", "ausbildung", "erfahrung"],
  Italian: ["il", "la", "di", "con", "per", "progetto", "competenze", "formazione", "esperienza"],
  Portuguese: ["o", "a", "de", "com", "para", "projeto", "habilidades", "educação", "experiência"],
  Turkish: ["ve", "ile", "için", "proje", "beceriler", "eğitim", "deneyim"],
};

const allowedEnglishTech = new Set([
  "react", "node", "nodejs", "express", "mongodb", "python", "javascript", "html", "css",
  "sql", "github", "git", "api", "apis", "rest", "ai", "llm", "c++", "scikit", "learn",
  "librosa", "nust", "webrtc"
]);

const forbiddenEnglishWords = new Set([
  "student", "profile", "dedicated", "clear", "focus", "growth", "practical", "learning",
  "real", "world", "contribution", "computer", "science", "hands", "experience",
  "development", "completed", "academic", "projects", "including", "system", "skilled",
  "seeking", "internship", "portfolio", "highlights", "skills", "provided", "professional",
  "opportunities", "built", "created", "implemented", "worked", "explored", "education",
  "workshops", "certifications", "using", "developed", "managed", "application"
]);

function flattenLocalized(out) {
  const loc = out.localizedOutput || {};
  const parts = [
    loc.medium,
    loc.bio,
    loc.artistStatement,
    ...(Array.isArray(loc.skills) ? loc.skills : []),
    ...(Array.isArray(loc.projects) ? loc.projects.flatMap(p => [p.title, p.desc]) : []),
    ...(Array.isArray(loc.customSections)
      ? loc.customSections.flatMap(s => [
          s.name,
          ...(Array.isArray(s.items) ? s.items.flatMap(i => [i.heading, i.desc]) : [])
        ])
      : [])
  ];
  return parts.filter(Boolean).join(" ");
}

function collectFields(out) {
  const loc = out.localizedOutput || {};
  const fields = [];
  const add = (path, value) => {
    if (String(value || "").trim()) fields.push({ path, value: String(value) });
  };

  add("medium", loc.medium);
  add("bio", loc.bio);
  add("artistStatement", loc.artistStatement);

  (loc.skills || []).forEach((v, i) => add(`skills[${i}]`, v));
  (loc.projects || []).forEach((p, i) => {
    add(`projects[${i}].title`, p.title);
    add(`projects[${i}].desc`, p.desc);
  });
  (loc.customSections || []).forEach((s, i) => {
    add(`customSections[${i}].name`, s.name);
    (s.items || []).forEach((it, j) => {
      add(`customSections[${i}].items[${j}].heading`, it.heading);
      add(`customSections[${i}].items[${j}].desc`, it.desc);
    });
  });

  return fields;
}

function englishLeakScore(text) {
  const tokens = String(text || "").toLowerCase().match(/\b[a-z][a-z]+\b/g) || [];
  return tokens.filter(t => forbiddenEnglishWords.has(t) && !allowedEnglishTech.has(t)).length;
}

function validateLanguage(target, out) {
  const text = flattenLocalized(out);
  const fields = collectFields(out);
  const failures = [];

  if (!out.localizedOutput || typeof out.localizedOutput !== "object") {
    failures.push("missing localizedOutput");
    return failures;
  }

  if (target !== "English" && !text.trim()) {
    failures.push("empty localized text");
  }

  if (scriptChecks[target] && !scriptChecks[target].test(text)) {
    failures.push(`missing ${target} script`);
  }

  if (languageSignals[target]) {
    const lower = text.toLowerCase();
    const hits = languageSignals[target].filter(w => lower.includes(w)).length;
    if (hits < 2) failures.push(`weak ${target} signal: only ${hits} marker(s)`);
  }

  if (target !== "English" && !scriptChecks[target]) {
    const leakFields = fields
      .map(f => ({ ...f, score: englishLeakScore(f.value) }))
      .filter(f => f.score >= 2);

    if (leakFields.length) {
      failures.push(
        "English leak fields: " +
          leakFields.slice(0, 8).map(f => `${f.path}="${f.value.slice(0, 90)}"`).join(" | ")
      );
    }
  }

  if (target === "English") {
    const hasEnglish = /\b(student|project|skills|experience|education|development)\b/i.test(text);
    if (!hasEnglish) failures.push("English output does not look English");
  }

  return failures;
}

async function generate(profile, targetLanguage) {
  const response = await fetch(`${API}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...profile,
      targetLanguage,
      aiTone: "Professional",
      enhanceProjectDescriptions: true,
      contact: {
        email: "test@example.com",
        linkedin: "https://www.linkedin.com/in/test",
        github: "https://github.com/test"
      }
    })
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response ${response.status}: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${data.error || text.slice(0, 300)}`);
  }

  return data;
}

async function main() {
  const mode = process.argv.includes("--full") ? "full" : "smoke";
  const cases = [];

  if (mode === "full") {
    for (const profile of profiles) {
      for (const lang of TARGET_LANGUAGES) cases.push({ profile, lang });
    }
  } else {
    TARGET_LANGUAGES.forEach((lang, i) => {
      cases.push({ profile: profiles[i % profiles.length], lang });
    });
  }

  const results = [];
  let pass = 0;
  let fail = 0;

  for (const test of cases) {
    const label = `${test.profile.label} -> ${test.lang}`;
    process.stdout.write(`Testing ${label} ... `);

    try {
      const data = await generate(test.profile, test.lang);
      const failures = validateLanguage(test.lang, data);

      if (failures.length) {
        fail++;
        console.log("FAIL");
        failures.forEach(f => console.log("  - " + f));
      } else {
        pass++;
        console.log("PASS");
      }

      results.push({
        label,
        targetLanguage: test.lang,
        responseTargetLanguage: data.targetLanguage,
        warnings: data.warning || "",
        failures,
        localizedOutput: data.localizedOutput || null
      });
    } catch (error) {
      fail++;
      console.log("ERROR");
      console.log("  - " + error.message);
      results.push({ label, targetLanguage: test.lang, error: error.message });
    }
  }

  fs.writeFileSync("language-regression-report.json", JSON.stringify({ pass, fail, results }, null, 2), "utf8");

  console.log("");
  console.log(`RESULT: ${pass} passed, ${fail} failed`);
  console.log("Report saved: language-regression-report.json");

  if (fail) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
