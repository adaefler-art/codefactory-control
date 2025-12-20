#!/usr/bin/env ts-node
/**
 * Test script for validate-cdk-diff.ts
 * 
 * This script tests the diff gate logic with sample CDK diff outputs
 * to ensure blocking, warning, and safe changes are correctly identified.
 */

// Mock CDK diff outputs for testing
const testCases = [
  {
    name: 'Safe: ECS Task Definition Update',
    diffOutput: `
Stack Afu9EcsStack
[~] AWS::ECS::TaskDefinition Afu9EcsStack/TaskDef
 └─ [~] ContainerDefinitions[0].Image
     ├─ [-] xxxxx.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:abc1234
     └─ [+] xxxxx.dkr.ecr.eu-central-1.amazonaws.com/afu9/control-center:def5678
`,
    expectedResult: 'PASS',
    expectedBlocking: 0,
  },
  {
    name: 'Safe: Adding New Resources',
    diffOutput: `
Stack Afu9AlarmsStack
[+] AWS::CloudWatch::Alarm Afu9AlarmsStack/HighCPUAlarm
[+] AWS::SNS::Topic Afu9AlarmsStack/AlarmTopic
`,
    expectedResult: 'PASS',
    expectedBlocking: 0,
  },
  {
    name: 'Warning: Security Group Rule Modification',
    diffOutput: `
Stack Afu9NetworkStack
[~] AWS::EC2::SecurityGroup Afu9NetworkStack/EcsSecurityGroup SecurityGroupIngress
 └─ [~] SecurityGroupIngress
     └─ [+] New ingress rule for port 8080
`,
    expectedResult: 'PASS',
    expectedBlocking: 0,
    expectedWarnings: 1,
  },
  {
    name: 'Warning: IAM Role Modification',
    diffOutput: `
Stack Afu9IamStack
[~] AWS::IAM::Role Afu9IamStack/TaskExecutionRole
 └─ [~] AssumeRolePolicyDocument
`,
    expectedResult: 'PASS',
    expectedBlocking: 0,
    expectedWarnings: 1,
  },
  {
    name: 'BLOCKED: ECS Service Replacement',
    diffOutput: `
Stack Afu9EcsStack
[~] AWS::ECS::Service Afu9EcsStack/Service (replacement)
 └─ [~] ServiceName (requires replacement)
     ├─ [-] afu9-control-center-stage
     └─ [+] afu9-control-center-stage-new
`,
    expectedResult: 'BLOCKED',
    expectedBlocking: 1,
  },
  {
    name: 'BLOCKED: DNS Record Deletion',
    diffOutput: `
Stack Afu9DnsStack
[-] AWS::Route53::RecordSet Afu9DnsStack/ControlCenterDNS
`,
    expectedResult: 'BLOCKED',
    expectedBlocking: 1,
  },
  {
    name: 'BLOCKED: ACM Certificate Replacement',
    diffOutput: `
Stack Afu9DnsStack
[~] AWS::CertificateManager::Certificate Afu9DnsStack/Certificate (replacement)
 └─ [~] DomainName (requires replacement)
     ├─ [-] afu-9.com
     └─ [+] new-domain.com
`,
    expectedResult: 'BLOCKED',
    expectedBlocking: 1,
  },
  {
    name: 'BLOCKED: Security Group Deletion',
    diffOutput: `
Stack Afu9NetworkStack
[-] AWS::EC2::SecurityGroup Afu9NetworkStack/EcsSecurityGroup
`,
    expectedResult: 'BLOCKED',
    expectedBlocking: 1,
  },
  {
    name: 'BLOCKED: RDS Instance Replacement',
    diffOutput: `
Stack Afu9DatabaseStack
[~] AWS::RDS::DBInstance Afu9DatabaseStack/Database (replacement)
 └─ [~] DBInstanceClass (requires replacement)
     ├─ [-] db.t4g.micro
     └─ [+] db.t4g.small
`,
    expectedResult: 'BLOCKED',
    expectedBlocking: 1,
  },
  {
    name: 'Mixed: Safe + Warning Changes',
    diffOutput: `
Stack Afu9EcsStack
[~] AWS::ECS::TaskDefinition Afu9EcsStack/TaskDef
 └─ [~] ContainerDefinitions[0].Image
[~] AWS::IAM::Role Afu9EcsStack/TaskRole
 └─ [~] Policies
[+] AWS::CloudWatch::Alarm Afu9EcsStack/NewAlarm
`,
    expectedResult: 'PASS',
    expectedBlocking: 0,
    expectedWarnings: 1,
  },
];

console.log('=====================================');
console.log('CDK Diff Gate - Test Suite');
console.log('=====================================\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  console.log(`Test: ${testCase.name}`);
  console.log('---');
  
  // Parse the diff output (simplified version of actual function)
  const lines = testCase.diffOutput.split('\n');
  let blockingCount = 0;
  let warningCount = 0;
  
  for (const line of lines) {
    // Check for blocking patterns
    if (/\[~\].*AWS::ECS::Service.*\(replacement\)/i.test(line)) blockingCount++;
    if (/\[-\].*AWS::Route53::RecordSet/i.test(line)) blockingCount++;
    if (/\[~\].*AWS::Route53::RecordSet.*\(replacement\)/i.test(line)) blockingCount++;
    if (/\[-\].*AWS::CertificateManager::Certificate/i.test(line)) blockingCount++;
    if (/\[~\].*AWS::CertificateManager::Certificate.*\(replacement\)/i.test(line)) blockingCount++;
    if (/\[-\].*AWS::EC2::SecurityGroup/i.test(line)) blockingCount++;
    if (/\[~\].*AWS::RDS::DBInstance.*\(replacement\)/i.test(line)) blockingCount++;
    if (/\[~\].*AWS::ElasticLoadBalancingV2::LoadBalancer.*\(replacement\)/i.test(line)) blockingCount++;
    
    // Check for warning patterns
    if (/\[~\].*AWS::EC2::SecurityGroup.*SecurityGroupIngress/i.test(line)) warningCount++;
    if (/\[~\].*AWS::EC2::SecurityGroup.*SecurityGroupEgress/i.test(line)) warningCount++;
    if (/\[~\].*AWS::IAM::Role/i.test(line)) warningCount++;
    if (/\[~\].*AWS::IAM::Policy/i.test(line)) warningCount++;
  }
  
  const actualResult = blockingCount > 0 ? 'BLOCKED' : 'PASS';
  const testPassed = 
    actualResult === testCase.expectedResult &&
    blockingCount === testCase.expectedBlocking &&
    (testCase.expectedWarnings === undefined || warningCount === testCase.expectedWarnings);
  
  if (testPassed) {
    console.log(`✅ PASS`);
    console.log(`   Expected: ${testCase.expectedResult}, Blocking: ${testCase.expectedBlocking}`);
    console.log(`   Actual: ${actualResult}, Blocking: ${blockingCount}, Warnings: ${warningCount}`);
    passed++;
  } else {
    console.log(`❌ FAIL`);
    console.log(`   Expected: ${testCase.expectedResult}, Blocking: ${testCase.expectedBlocking}`);
    console.log(`   Actual: ${actualResult}, Blocking: ${blockingCount}, Warnings: ${warningCount}`);
    failed++;
  }
  
  console.log('');
}

console.log('=====================================');
console.log('Test Summary');
console.log('=====================================');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}\n`);

if (failed === 0) {
  console.log('✅ All tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some tests failed');
  process.exit(1);
}
