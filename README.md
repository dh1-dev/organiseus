# OrganiseUs Cloudflare Worker

The repository is deliberately flat so all files can be uploaded from a phone.

Cloudflare deployment command:

    npx wrangler deploy

`worker.js` handles `/api/login`, `/api/session`, `/api/logout`, and
`/api/recover`. Static files are served from the repository root, while
`.assetsignore` prevents Worker source/configuration from being published as
website assets.
