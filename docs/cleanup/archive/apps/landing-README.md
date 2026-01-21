# AFU-9 Landing Page

Retro terminal-style login interface for AFU-9 authentication.

## Features

- Black full-screen terminal UI with centered terminal area
- Keyboard-only flow with blinking white block cursor
- Username and password input with Enter key progression
- Password masking during input
- AWS Cognito authentication with USER_PASSWORD_AUTH flow
- Group-based redirect logic (admin-prod → prod, default → stage)
- HttpOnly Secure cookies for session management

## Environment Variables

Create a `.env.local` file with the following variables:

```bash
COGNITO_USER_POOL_ID=your-user-pool-id
COGNITO_CLIENT_ID=your-client-id
COGNITO_REGION=eu-central-1  # Default if not specified
```

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env.local`

3. Run the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser

## Authentication Flow

1. User visits `/` and sees terminal prompt for username
2. User types username and presses Enter
3. Terminal shows password prompt
4. User types password (masked with asterisks) and presses Enter
5. Terminal shows "authenticating..." message
6. On success:
   - Sets HttpOnly Secure cookies (`afu9_id`, `afu9_access`)
   - Redirects based on Cognito groups:
     - `afu9-admin-prod` → https://prod.afu-9.com/
     - Default → https://stage.afu-9.com/
7. On failure:
   - Terminal resets to initial state (generic error, no details)

## API Endpoint

### POST /api/login

Authenticates user with AWS Cognito and sets session cookies.

**Request Body:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Success Response (200):**
```json
{
  "redirectUrl": "https://prod.afu-9.com/" // or stage URL
}
```

**Error Response (401):**
```json
{
  "error": "Authentication failed"
}
```

## Security

- No secrets exposed to client-side code
- HttpOnly cookies prevent XSS access to tokens
- Secure flag ensures HTTPS-only transmission
- SameSite=Lax prevents CSRF attacks
- Generic error messages prevent user enumeration
- Failed authentication resets terminal without revealing details

## Build

```bash
npm run build
npm start
```
