import { Octokit } from "octokit";
import { getGithubSecrets } from "../../lib/utils/secrets";
import { LambdaLogger } from "./logger";

const logger = new LambdaLogger('afu9-issue-interpreter');

interface StateInput {
  repo: string;
  targetBranch: string;
  issueNumber?: string | null;
}

export const handler = async (event: StateInput) => {
  logger.info("AFU-9 IssueInterpreter started", { 
    repo: event.repo,
    targetBranch: event.targetBranch,
    issueNumber: event.issueNumber ? String(event.issueNumber) : undefined
  });

  // Load GitHub secrets from AWS Secrets Manager or environment
  const githubSecrets = await getGithubSecrets();
  const GITHUB_TOKEN = githubSecrets.token;

  // Validate required credentials
  if (!GITHUB_TOKEN) {
    logger.error("GitHub token not found in secrets");
    throw new Error("Configuration error: GitHub token is not configured");
  }

  try {
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    let issue = null;

    if (event.issueNumber) {
      const [owner, repo] = event.repo.split("/");
      const issueNumber = Number(event.issueNumber);

      logger.info("Fetching GitHub issue", { 
        issueNumber,
        owner,
        repo 
      });
      
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
        
        logger.info("Successfully fetched issue", { 
          issueNumber,
          title: data.title,
          labelCount: issue.labels.length 
        });
      } catch (error) {
        logger.error("Failed to fetch GitHub issue", error, {
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

    const classification = issue
      ? {
          type: "bug",
          confidence: 0.6,
          reason: "v0.1 stub: treat all issues as bug"
        }
      : {
          type: "ad_hoc",
          confidence: 0.5,
          reason: "no issueNumber provided"
        };

    logger.info("Issue interpretation completed", {
      repo: event.repo,
      issueNumber: event.issueNumber ? String(event.issueNumber) : undefined,
      classificationType: classification.type,
      confidence: classification.confidence
    });

    return {
      ...event,
      issue,
      classification
    };
  } catch (error) {
    logger.error("Error in IssueInterpreter", error, {
      repo: event.repo,
      issueNumber: event.issueNumber ? String(event.issueNumber) : undefined
    });
    throw error;
  }
};
