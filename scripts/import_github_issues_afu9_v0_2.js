// scripts/import_github_issues_afu9_v0_2.js
//
// Version wie das RHYTHM-Script, aber mit festem JSON-Pfad nach Wunsch:
//
//   C:\Users\ADAEFLER\OneDrive - Otto Group\Projekte\codefactory\scripts\afu9_v0_2_issues.json
//
// Environment-Variablen:
//   GITHUB_TOKEN
//   GITHUB_OWNER
//   GITHUB_REPO
//
// Ausführung:
//   node scripts/import_github_issues_afu9_v0_2.js
//

const fs = require("fs");
const https = require("https");
const path = require("path");

// Fester Pfad zur Issues-Datei:
const ISSUES_FILE = path.normalize(
  "C:/Users/ADAEFLER/OneDrive - Otto Group/Projekte/codefactory/scripts/afu9_v0_2_issues.json"
);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
  console.error(
    "Bitte GITHUB_TOKEN, GITHUB_OWNER und GITHUB_REPO als Environment-Variablen setzen."
  );
  process.exit(1);
}

function githubRequest(pathname, method, bodyObj) {
  const data = bodyObj ? JSON.stringify(bodyObj) : null;

  const options = {
    hostname: "api.github.com",
    path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}${pathname}`,
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "User-Agent": "afu9-issue-import-script",
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
  };

  if (data) {
    options.headers["Content-Type"] = "application/json";
    options.headers["Content-Length"] = Buffer.byteLength(data);
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(
            new Error(
              `GitHub API Fehler ${res.statusCode}: ${body || res.statusMessage}`
            )
          );
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on("error", reject);

    if (data) req.write(data);
    req.end();
  });
}

async function createIssue({ title, body, labels }) {
  const payload = { title, body };
  if (labels?.length) payload.labels = labels;

  const issue = await githubRequest("/issues", "POST", payload);
  console.log(`Issue erstellt: #${issue.number} – ${issue.title}`);

  return issue;
}

async function main() {
  console.log("Lese Issues aus Datei:");
  console.log(" → " + ISSUES_FILE);

  const raw = fs.readFileSync(ISSUES_FILE, "utf8");
  const spec = JSON.parse(raw);

  const epicKeyToNumber = {};

  console.log("\n=== EPICS ANLEGEN ===");
  for (const epic of spec.epics || []) {
    const labels = epic.labels?.length ? epic.labels : ["epic"];

    const issue = await createIssue({
      title: epic.title,
      body: epic.body || "",
      labels
    });

    epicKeyToNumber[epic.key] = issue.number;
  }

  console.log("\n=== ISSUES ANLEGEN ===");
  for (const issueDef of spec.issues || []) {
    let body = issueDef.body || "";
    const labels = issueDef.labels ? [...issueDef.labels] : [];

    if (issueDef.parent) {
      const epicNumber = epicKeyToNumber[issueDef.parent];
      if (epicNumber) {
        body += `\n\n---\nParent Epic: #${epicNumber}\n`;
        if (!labels.includes("child-of-epic")) labels.push("child-of-epic");
      } else {
        console.warn(
          `WARNUNG: Parent Epic '${issueDef.parent}' wurde nicht gefunden.`
        );
      }
    }

    await createIssue({
      title: issueDef.title,
      body,
      labels
    });
  }

  console.log("\nFERTIG – Alle Epics & Issues wurden in GitHub angelegt.");
}

main().catch((err) => {
  console.error("FEHLER beim Import:", err);
  process.exit(1);
});
