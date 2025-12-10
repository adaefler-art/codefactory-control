"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// infra/lambdas/afu9_orchestrator.ts
var afu9_orchestrator_exports = {};
__export(afu9_orchestrator_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(afu9_orchestrator_exports);
var import_client_sfn = require("@aws-sdk/client-sfn");
var sfn = new import_client_sfn.SFNClient({});
var STATE_MACHINE_ARN = process.env.AFU9_STATE_MACHINE_ARN;
var handler = async (event) => {
  console.log("AFU-9 Orchestrator v0.1 start", { event });
  const input = {
    repo: event.repo,
    ref: event.ref,
    targetBranch: event.targetBranch,
    issueNumber: event.issueNumber ?? null,
    githubRunId: event.githubRunId,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  const command = new import_client_sfn.StartExecutionCommand({
    stateMachineArn: STATE_MACHINE_ARN,
    input: JSON.stringify(input)
  });
  const result = await sfn.send(command);
  console.log("Started AFU-9 State Machine", { result });
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "AFU-9 State Machine started",
      executionArn: result.executionArn
    })
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
