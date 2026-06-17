# ShikiV4 Discord Bot

ShikiV4 connects public Love Form Studio forms to Discord through Firebase Realtime Database.

Flow:

```text
Web form > Firebase Realtime Database > ShikiV4 bot > Discord channel
```

## Required env

Copy `.env.example` to `.env` for local use.

```env
BOT_TOKEN=
CLIENT_ID=
PORT=10000
FORM_BASE_URL=https://roleplayfrom.vercel.app
FIREBASE_DATABASE_URL=https://namez-base-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_BASE64=
```

Use `FIREBASE_SERVICE_ACCOUNT_BASE64` on hosting panels because it avoids multiline private-key issues.
`FIREBASE_DATABASE_URL` already defaults to `https://namez-base-default-rtdb.firebaseio.com`, so the service account is the important missing value when the bridge says it is disabled.

This patch pins `firebase-admin` to `12.7.0` so hosts running Node 19 do not receive Firebase `EBADENGINE` warnings that require Node 20.

To create `FIREBASE_SERVICE_ACCOUNT_BASE64` on Windows PowerShell:

```powershell
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Content -Raw ".\service-account.json")))
```

Paste the whole output into Wispbyte. Do not paste only the `private_key` value.

Wrong:

```env
FIREBASE_SERVICE_ACCOUNT_BASE64=https://namez-base-default-rtdb.firebaseio.com/
```

Correct:

```env
FIREBASE_DATABASE_URL=https://namez-base-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_BASE64=ewogICJ0eXBlIjogInNlcnZpY2VfYWNjb3VudCIs...
```

For local testing only, you can point directly to the downloaded JSON file instead of converting it:

```env
FIREBASE_SERVICE_ACCOUNT_FILE=C:\Users\windows\Downloads\namez-base-firebase-adminsdk-fbsvc-abdbab0c6c.json
```

## Discord requirements

Enable these bot permissions/intents:

- Slash commands
- Send Messages
- Embed Links
- Manage Roles if using role assignment
- Server Members Intent for welcome/goodbye embeds

## Main slash commands

```text
/form project project_id:<website-project-id>
/form summary channel:#summary template:<message> title:<title> color:#00D1FF
/form announce channel:#forms title:<title> description:<message> button_label:<label> send_now:true
/form send
/form role role:@role
/welcome setup channel:#welcome title:<title> description:<message> enabled:true
/welcome test
/welcome disable
/goodbye setup channel:#goodbye title:<title> description:<message> enabled:true
/goodbye test
/goodbye disable
/bot settings
/bot reset target:<all|form|summary|welcome|goodbye>
/preview target:<form|summary|welcome|goodbye>
```

## Placeholders

Welcome and goodbye embeds:

```text
{user}
{time}
{user_avatar}
{user_id}
{server}
```

Summary embeds:

```text
{1} ... {20}
{user_mb}
{timing}
```

Form announcement embeds:

```text
{form_url}
{time}
```

Note: Discord embed image and thumbnail fields require an HTTPS image URL or a supported placeholder such as `{user_avatar}`.

## Firebase record format

Website submissions are written as:

```json
{
  "answers": {},
  "status": "pending",
  "captchaChecked": true,
  "createdAt": 0
}
```

The bot changes `status` to `processing`, then `sent` or `error`.
