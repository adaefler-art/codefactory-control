import { Octokit } from "octokit";
import { getGithubSecrets } from "../../lib/utils/secrets";

interface StateInput {
  repo: string;
  targetBranch: string;
  issueNumber?: string | null;
}

export const handler = async (event: StateInput) => {
  console.log("AFU-9 IssueInterpreter v0.1", { event });

  // Load GitHub secrets from AWS Secrets Manager or environment
  const githubSecrets = await getGithubSecrets();
  const GITHUB_TOKEN = githubSecrets.token;

  // Validate required credentials
  if (!GITHUB_TOKEN) {
    console.error("GitHub token not found in secrets");
    throw new Error("Configuration error: GitHub token is not configured");
  }

  try {
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    let issue = null;

    if (event.issueNumber) {
      const [owner, repo] = event.repo.split("/");
      const issueNumber = Number(event.issueNumber);

      console.log(`Fetching issue #${issueNumber} from ${owner}/${repo}...`);
      
      try {
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
        
        console.log(`Successfully fetched issue #${issueNumber}`);
      } catch (error) {
        console.error("Error fetching GitHub issue:", {
          error: error instanceof Error ? error.message : String(error),
          issueNumber,
          owner,
          repo,
        });
        
        if (error instanceof Error && error.message.includes("Not Found")) {
          throw new Error(`GitHub issue #${issueNumber} not found in ${owner}/${repo}`);
        }
        
        throw error;
      }
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
  } catch (error) {
    console.error("Error in IssueInterpreter:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};
