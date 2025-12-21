# Deploy: Afu9DeployMemoryStack + CodefactoryControlStack

Deploy von CodefactoryControlStack nur bei diff.

```bash
# One-time build
cd c:/dev/codefactory
npm run build

# Stack commands (repeat flags per step)
npx cdk synth Afu9DeployMemoryStack --profile codefactory --region eu-central-1 -c afu9-domain=afu-9.com -c afu9-enable-database=true -c afu9-enable-https=false
npx cdk diff  Afu9DeployMemoryStack --profile codefactory --region eu-central-1 -c afu9-domain=afu-9.com -c afu9-enable-database=true -c afu9-enable-https=false
npx cdk deploy Afu9DeployMemoryStack --profile codefactory --region eu-central-1 -c afu9-domain=afu-9.com -c afu9-enable-database=true -c afu9-enable-https=false --require-approval never
aws cloudformation describe-stacks --stack-name Afu9DeployMemoryStack --profile codefactory --region eu-central-1 --query "Stacks[0].{Status:StackStatus,Reason:StackStatusReason}" --output table

# For completeness (already up-to-date, no diff)
npx cdk synth CodefactoryControlStack --profile codefactory --region eu-central-1 -c afu9-domain=afu-9.com -c afu9-enable-database=true -c afu9-enable-https=false
npx cdk diff  CodefactoryControlStack --profile codefactory --region eu-central-1 -c afu9-domain=afu-9.com -c afu9-enable-database=true -c afu9-enable-https=false
# (deploy skipped: no differences)
```

Optional Verifikation (DynamoDB):

```bash
aws dynamodb describe-table --table-name afu9_deploy_memory --profile codefactory --region eu-central-1 --query "Table.{Name:TableName,Status:TableStatus,Arn:TableArn}" --output table
```
