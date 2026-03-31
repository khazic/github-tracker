# GitHub Tracker

A lightweight React app for tracking the public pull requests and issues authored by any GitHub user.

## What it shows

- Public PRs authored by a username
- Public issues authored by a username
- Open vs closed counts
- Repository grouping
- Only the first 5 items shown per repository, with a link to view the rest on GitHub

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

This repo is already configured for a project-page deployment at:

- `https://khazic.github.io/github-tracker/`

Recommended setup:

1. Create a public repository named `github-tracker` under the `khazic` account
2. Push this project to the `main` branch
3. In the repository settings, open `Pages`
4. Set `Source` to `GitHub Actions`
5. Push new commits to `main` and let the workflow deploy automatically

## Notes

- This app uses the public GitHub Search API, so it only tracks public repositories.
- Unauthenticated GitHub API requests have rate limits. If you hit them, wait a bit and reload.
- The app currently loads up to 300 PRs and 300 issues per user to keep requests predictable.
- The Vite base path is set in [`vite.config.js`](/Users/liuyibo/Desktop/github-public-tracker/vite.config.js) for the `github-tracker` repository name.

## Optional Cloudflare Worker for near-real-time refresh

This repo now includes a Worker scaffold in [`cloudflare/worker.mjs`](/Users/liuyibo/Desktop/github-public-tracker/cloudflare/worker.mjs).

To finish deployment:

1. Log in to Cloudflare with `wrangler login`
2. `cd cloudflare`
3. Create the Worker with `wrangler deploy`
4. Add the GitHub token secret with `wrangler secret put GITHUB_TOKEN`
5. Copy the deployed `workers.dev` URL into [`public/worker-config.json`](/Users/liuyibo/Desktop/github-public-tracker/public/worker-config.json) as the `endpoint`
6. Push this repo again so GitHub Pages picks up the Worker endpoint

Behavior:

- If `worker-config.json` has an endpoint, the frontend asks the Worker for fresh data on page load.
- If the Worker is unavailable, the site falls back to the last generated static snapshot in `public/data.json`.
