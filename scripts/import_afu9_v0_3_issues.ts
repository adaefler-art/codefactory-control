import { readFileSync } from 'fs';
import path from 'path';
import { Octokit } from 'octokit';

interface Epic {
  id: string;
  title: string;
  description?: string;
}

interface Issue {
  id: string; // X.Y
  title: string;
  epicId: string;
  ziel?: string;
  beschreibung?: string;
  akzeptanz?: string;
  prioritaet?: string;
  kpi?: string;
}

interface ParsedRoadmap {
  epics: Epic[];
  issues: Issue[];
}

function parseRoadmap(filePath: string): ParsedRoadmap {
  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const epics: Epic[] = [];
  const issues: Issue[] = [];
  let currentEpicId: string | null = null;

  const getSection = (
    startIndex: number,
    stopPred: (line: string) => boolean
  ): { text: string; nextIndex: number } => {
    const buff: string[] = [];
    let i = startIndex;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (stopPred(line)) break;
      buff.push(line);
    }
    return { text: buff.join('\n').trim(), nextIndex: i };
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const epicMatch = line.match(/^##\s+EPIC\s+(\d+)\s+—\s+(.*)$/);
    if (epicMatch) {
      const [, id, title] = epicMatch;
      currentEpicId = id;
      // Capture description until next heading (## or ###)
      const { text, nextIndex } = getSection(i + 1, (l) => /^#{2,3}\s/.test(l));
      epics.push({ id, title: title.trim(), description: text || undefined });
      i = nextIndex - 1;
      continue;
    }

    const issueMatch = line.match(/^###\s+Issue\s+(\d+\.\d+)\s+—\s+(.*)$/);
    if (issueMatch) {
      const [, id, title] = issueMatch;
      const issue: Issue = { id, title: title.trim(), epicId: currentEpicId || '' };

      const stopPred = (l: string) => /^#{2,3}\s/.test(l) || /^---$/.test(l);
      let j = i + 1;
      while (j < lines.length) {
        if (stopPred(lines[j])) break;
        const sectionLine = lines[j];
        const sectionMatch = sectionLine.match(/^\*\*([^*]+)\*\*:\s*(.*)$/);
        if (sectionMatch) {
          const [, key, rest] = sectionMatch;
          const label = key.trim().toLowerCase();
          const { text, nextIndex } = getSection(j + 1, (l) => /^\*\*[^*]+\*\*:\s*/.test(l) || stopPred(l));
          const fullText = [rest, text].filter(Boolean).join('\n').trim();
          switch (label) {
            case 'ziel':
              issue.ziel = fullText;
              break;
            case 'beschreibung':
              issue.beschreibung = fullText;
              break;
            case 'akzeptanzkriterien':
              issue.akzeptanz = fullText;
              break;
            case 'priorität':
            case 'prioritat':
              issue.prioritaet = fullText;
              break;
            case 'kpi':
              issue.kpi = fullText;
              break;
            default:
              break;
          }
          j = nextIndex;
          continue;
        }
        j++;
      }
      issues.push(issue);
      i = j - 1;
      continue;
    }
  }

  return { epics, issues };
}

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

async function findExistingIssue(octokit: Octokit, owner: string, repo: string, canonicalId: string): Promise<number | null> {
  const q = `repo:${owner}/${repo} in:title "${canonicalId}"`;
  const res = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 5 });
  const hit = res.data.items.find((item) => item.title.includes(canonicalId));
  return hit ? hit.number : null;
}

function buildEpicBody(epic: Epic): string {
  const parts = [`Canonical ID: EPIC ${epic.id}`, `Title: ${epic.title}`];
  if (epic.description) parts.push('', epic.description);
  return parts.join('\n');
}

function buildIssueBody(issue: Issue, epicNumber: number | null): string {
  const lines: string[] = [];
  if (epicNumber) lines.push(`Epic: #${epicNumber}`);
  lines.push(`Canonical ID: Issue ${issue.id}`);
  if (issue.ziel) {
    lines.push('', '## Ziel', issue.ziel);
  }
  if (issue.beschreibung) {
    lines.push('', '## Beschreibung', issue.beschreibung);
  }
  if (issue.akzeptanz) {
    lines.push('', '## Akzeptanzkriterien', issue.akzeptanz);
  }
  if (issue.prioritaet) {
    lines.push('', '## Priorität', issue.prioritaet);
  }
  if (issue.kpi) {
    lines.push('', '## KPI', issue.kpi);
  }
  return lines.join('\n');
}

async function main() {
  const token = requireEnv('GITHUB_TOKEN');
  const repoEnv = requireEnv('GITHUB_REPOSITORY');
  const [owner, repo] = repoEnv.split('/');
  const filePath = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('docs/roadmaps/afu9_roadmap_v0_3_issues.md');

  const octokit = new Octokit({ auth: token });
  const { epics, issues } = parseRoadmap(filePath);

  const idToNumber = new Map<string, number>();
  const report: Record<string, string> = {};

  // Create/Update Epics first
  for (const epic of epics) {
    const canonicalId = `EPIC ${epic.id}`;
    const existing = await findExistingIssue(octokit, owner, repo, canonicalId);
    const labels = ['afu9', 'v0.3', 'epic'];
    const body = buildEpicBody(epic);
    let number: number;
    if (existing) {
      await octokit.rest.issues.update({ owner, repo, issue_number: existing, title: `${canonicalId} — ${epic.title}`, body, labels });
      number = existing;
    } else {
      const res = await octokit.rest.issues.create({ owner, repo, title: `${canonicalId} — ${epic.title}`, body, labels });
      number = res.data.number;
    }
    idToNumber.set(epic.id, number);
    report[canonicalId] = `https://github.com/${owner}/${repo}/issues/${number}`;
  }

  // Then Issues
  for (const issue of issues) {
    const canonicalId = `Issue ${issue.id}`;
    const existing = await findExistingIssue(octokit, owner, repo, canonicalId);
    const labels = ['afu9', 'v0.3', 'issue'];
    const priority = issue.prioritaet?.match(/P\d/i)?.[0]?.toUpperCase();
    if (priority) labels.push(priority);
    const epicNumber = idToNumber.get(issue.epicId) || null;
    const body = buildIssueBody(issue, epicNumber);
    let number: number;
    if (existing) {
      await octokit.rest.issues.update({ owner, repo, issue_number: existing, title: `${canonicalId} — ${issue.title}`, body, labels });
      number = existing;
    } else {
      const res = await octokit.rest.issues.create({ owner, repo, title: `${canonicalId} — ${issue.title}`, body, labels });
      number = res.data.number;
    }
    report[canonicalId] = `https://github.com/${owner}/${repo}/issues/${number}`;
  }

  // Output JSON report
  process.stdout.write(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
