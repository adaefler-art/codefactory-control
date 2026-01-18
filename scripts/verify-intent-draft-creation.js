/*
 * Verify INTENT draft creation (server-side tools)
 * Usage (PowerShell):
 *   $env:INTENT_BASE_URL="https://staging.example.com";
 *   $env:INTENT_SESSION_ID="<session-id>";
 *   $env:INTENT_AUTH_COOKIE="afu9_session=..."; # or $env:INTENT_BEARER_TOKEN
 *   node scripts/verify-intent-draft-creation.js
 */

const baseUrl = process.env.INTENT_BASE_URL || 'http://localhost:3000';
const sessionId = process.env.INTENT_SESSION_ID;
const authCookie = process.env.INTENT_AUTH_COOKIE;
const bearerToken = process.env.INTENT_BEARER_TOKEN;

if (!sessionId) {
  console.error('INTENT_SESSION_ID is required');
  process.exit(1);
}

const headers = {
  'Content-Type': 'application/json',
};

if (authCookie) {
  headers.Cookie = authCookie;
}

if (bearerToken) {
  headers.Authorization = `Bearer ${bearerToken}`;
}

async function run() {
  const messageUrl = `${baseUrl}/api/intent/sessions/${sessionId}/messages`;
  const draftUrl = `${baseUrl}/api/intent/sessions/${sessionId}/issue-draft`;

  const messagePayload = {
    content: 'create minimal draft canonicalId=TEST-DRAFT-001',
  };

  const messageResponse = await fetch(messageUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(messagePayload),
  });

  if (!messageResponse.ok) {
    const body = await messageResponse.text();
    throw new Error(`Message POST failed: ${messageResponse.status} ${body}`);
  }

  const draftResponse = await fetch(draftUrl, {
    method: 'GET',
    headers,
  });

  if (!draftResponse.ok) {
    const body = await draftResponse.text();
    throw new Error(`Draft GET failed: ${draftResponse.status} ${body}`);
  }

  const draftJson = await draftResponse.json();
  const draft = draftJson?.draft;

  if (!draft) {
    throw new Error('No draft returned (draft is null)');
  }

  if (draft.issue_json?.canonicalId !== 'TEST-DRAFT-001' && draft.issue_json?.canonical_id !== 'TEST-DRAFT-001') {
    throw new Error(`Draft canonicalId mismatch: ${draft.issue_json?.canonicalId || draft.issue_json?.canonical_id}`);
  }

  console.log('OK: Draft created', {
    id: draft.id,
    canonicalId: draft.issue_json?.canonicalId || draft.issue_json?.canonical_id,
  });
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
