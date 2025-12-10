import { Octokit } from "octokit";

const GITHUB_TOKEN = process.env.AFU9_GITHUB_TOKEN!;

interface StateInput {
  repo: string;
  targetBranch: string;
  issueNumber?: string | null;
}

export const handler = async (event: StateInput) => {
  console.log("AFU-9 IssueInterpreter v0.1", { event });

  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  let issue = null;

  if (event.issueNumber) {
    const [owner, repo] = event.repo.split("/");
    const issueNumber = Number(event.issueNumber);

    const { data } = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber
    });

    issue = {
      number: data.number,
      title: data.title,
      body: data.body ?? "",
      labels: (data.labels ?? []).map((l: any) =>
        typeof l === "string" ? l : l.name
      )
    };
  }

  return {
    ...event,
    issue,
    classification: issue
      ? {
          type: "bug",
          confidence: 0.6,
          reason: "v0.1 stub: treat all issues as bug"
        }
      : {
          type: "ad_hoc",
          confidence: 0.5,
          reason: "no issueNumber provided"
        }
  };
};
