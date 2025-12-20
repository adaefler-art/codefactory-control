type AgentStatus = "active" | "partial" | "planned" | "inactive";

interface Agent {
  name: string;
  status: AgentStatus;
  primaryResponsibility: string;
  allowedActions: string[];
  nonResponsibilities: string[];
}

const getStatusIcon = (status: AgentStatus): string => {
  switch (status) {
    case "active":
      return "✅";
    case "partial":
      return "🟡";
    case "planned":
      return "⚪";
    case "inactive":
      return "🔴";
  }
};

const getStatusLabel = (status: AgentStatus): string => {
  switch (status) {
    case "active":
      return "Active / Stable";
    case "partial":
      return "Partial / In Progress";
    case "planned":
      return "Planned";
    case "inactive":
      return "Inactive / Disabled";
  }
};

export default function NinefoldPage() {
  const agents: Agent[] = [
    {
      name: "INTENT Agent",
      status: "active",
      primaryResponsibility: "Receives and validates human intent, translating feature requests into actionable system inputs.",
      allowedActions: [
        "Parse incoming feature requests",
        "Validate input completeness",
        "Initiate workflow execution"
      ],
      nonResponsibilities: [
        "Does not write specifications",
        "Does not make architectural decisions",
        "Does not interact with code"
      ]
    },
    {
      name: "Interpreter Agent",
      status: "active",
      primaryResponsibility: "Analyzes intent and contextualizes requirements within the existing codebase and system constraints.",
      allowedActions: [
        "Analyze feature context",
        "Query codebase structure",
        "Identify affected components"
      ],
      nonResponsibilities: [
        "Does not write code",
        "Does not create specifications",
        "Does not make deployment decisions"
      ]
    },
    {
      name: "Spec Agent",
      status: "active",
      primaryResponsibility: "Generates detailed technical specifications from interpreted requirements using LLM assistance.",
      allowedActions: [
        "Generate technical specifications",
        "Define acceptance criteria",
        "Document implementation approach"
      ],
      nonResponsibilities: [
        "Does not write implementation code",
        "Does not execute tests",
        "Does not make deployment decisions"
      ]
    },
    {
      name: "Build Agent",
      status: "active",
      primaryResponsibility: "Generates and patches code artifacts based on specifications, producing implementation code.",
      allowedActions: [
        "Generate code from specifications",
        "Apply code patches",
        "Create necessary file structures"
      ],
      nonResponsibilities: [
        "Does not make architectural decisions",
        "Does not decide on test strategies",
        "Does not deploy code"
      ]
    },
    {
      name: "QA / Verification Agent",
      status: "active",
      primaryResponsibility: "Creates, executes, and validates tests to ensure code quality and specification compliance.",
      allowedActions: [
        "Generate test cases",
        "Execute test suites",
        "Validate code quality metrics"
      ],
      nonResponsibilities: [
        "Does not write production code",
        "Does not make verdict decisions",
        "Does not deploy artifacts"
      ]
    },
    {
      name: "Verdict Engine",
      status: "active",
      primaryResponsibility: "Decides on state transitions based on CI/CD results and quality gates.",
      allowedActions: [
        "Evaluate CI/CD outcomes",
        "Determine state transitions",
        "Trigger next workflow steps"
      ],
      nonResponsibilities: [
        "Does not write code",
        "Does not deploy",
        "Does not ask humans (autonomous decisions only)"
      ]
    },
    {
      name: "Deploy Agent",
      status: "active",
      primaryResponsibility: "Orchestrates deployment processes and manages rollout strategies to target environments.",
      allowedActions: [
        "Execute deployment workflows",
        "Manage branch operations",
        "Create pull requests"
      ],
      nonResponsibilities: [
        "Does not write application code",
        "Does not make verdict decisions",
        "Does not generate specifications"
      ]
    },
    {
      name: "Observe / Telemetry Agent",
      status: "partial",
      primaryResponsibility: "Monitors system behavior, collects metrics, and provides observability into the fabrication process.",
      allowedActions: [
        "Collect execution metrics",
        "Monitor system health",
        "Generate observability reports"
      ],
      nonResponsibilities: [
        "Does not modify code",
        "Does not make execution decisions",
        "Does not interact with deployments"
      ]
    },
    {
      name: "Memory / Learning Agent",
      status: "partial",
      primaryResponsibility: "Learns from past executions and continuously optimizes the fabrication process based on feedback.",
      allowedActions: [
        "Store execution patterns",
        "Analyze historical data",
        "Provide optimization recommendations"
      ],
      nonResponsibilities: [
        "Does not write code",
        "Does not make autonomous changes to workflow",
        "Does not deploy or execute tasks"
      ]
    },
  ];

  return (
    <div className="min-h-screen bg-white dark:bg-black p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-4 text-black dark:text-white">
          AFU-9 Ninefold Agent Model
        </h1>
        <p className="text-xl mb-8 text-gray-600 dark:text-gray-400">
          The canonical nine agents of the AFU-9 (Autonomous Fabrication Unit) system
        </p>

        <div className="grid grid-cols-1 gap-6">
          {agents.map((agent, index) => (
            <div
              key={index}
              className="p-6 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-800 rounded-lg"
            >
              <div className="flex items-start gap-4 mb-4">
                <span className="text-3xl font-bold text-purple-600 dark:text-purple-400 min-w-[2rem]">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-2xl font-semibold text-black dark:text-white">
                      {agent.name}
                    </h2>
                    <span className="flex items-center gap-2 px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-sm">
                      <span className="text-lg">{getStatusIcon(agent.status)}</span>
                      <span className="text-gray-700 dark:text-gray-300">
                        {getStatusLabel(agent.status)}
                      </span>
                    </span>
                  </div>
                  
                  <p className="text-gray-700 dark:text-gray-300 mb-4 text-base">
                    {agent.primaryResponsibility}
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-green-700 dark:text-green-400 mb-2">
                        ✓ Allowed Actions:
                      </h3>
                      <ul className="space-y-1">
                        {agent.allowedActions.map((action, idx) => (
                          <li key={idx} className="text-sm text-gray-600 dark:text-gray-400 pl-4">
                            • {action}
                          </li>
                        ))}
                      </ul>
                    </div>
                    
                    <div>
                      <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-2">
                        ✗ Explicit Non-Responsibilities:
                      </h3>
                      <ul className="space-y-1">
                        {agent.nonResponsibilities.map((nonResp, idx) => (
                          <li key={idx} className="text-sm text-gray-600 dark:text-gray-400 pl-4">
                            • {nonResp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Governance Footer */}
        <div className="mt-12 p-6 bg-purple-50 dark:bg-purple-900/20 border-2 border-purple-300 dark:border-purple-700 rounded-lg">
          <div className="flex items-start gap-3">
            <span className="text-2xl">⚖️</span>
            <div>
              <h3 className="text-lg font-semibold mb-2 text-purple-900 dark:text-purple-100">
                AFU-9 Governance Principles
              </h3>
              <p className="text-gray-800 dark:text-gray-200 italic">
                &ldquo;AFU-9 follows a strict Ninefold Agent Model. 
                Humans interact only via INTENT. 
                Verdicts, not opinions, drive execution.&rdquo;
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
