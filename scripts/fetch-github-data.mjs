const DEFAULT_USER = 'khazic'
const PAGE_SIZE = 100
const MAX_PAGES = 3
const BASE_URL = 'https://api.github.com'

async function githubFetch(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }

  const response = await fetch(`${BASE_URL}${path}`, { headers })

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${path}`)
  }

  return response.json()
}

async function searchGithub(query, page) {
  const params = new URLSearchParams({
    q: query,
    sort: 'updated',
    order: 'desc',
    per_page: PAGE_SIZE.toString(),
    page: page.toString(),
  })

  return githubFetch(`/search/issues?${params}`)
}

async function fetchAllItems(kind, username) {
  const query = `${kind} author:${username} archived:false`
  const pages = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await searchGithub(query, page)
    pages.push(...payload.items)

    if (payload.items.length < PAGE_SIZE) {
      break
    }
  }

  return pages
}

async function fetchPullRequestDetail(ownerRepo, number) {
  return githubFetch(`/repos/${ownerRepo}/pulls/${number}`)
}

async function hydratePullRequests(items) {
  return Promise.all(
    items.map(async (item) => {
      const ownerRepo = item.repository_url.replace('https://api.github.com/repos/', '')
      const detail = await fetchPullRequestDetail(ownerRepo, item.number)
      let derivedState = item.state

      if (detail.merged_at) {
        derivedState = 'merged'
      } else if (item.state === 'open' && detail.draft) {
        derivedState = 'draft'
      } else if (item.state === 'closed') {
        derivedState = 'closed_unmerged'
      }

      return {
        ...item,
        derivedState,
        merged_at: detail.merged_at,
        draft: detail.draft,
        mergeable_state: detail.mergeable_state,
      }
    }),
  )
}

async function main() {
  const [pullRequests, issues] = await Promise.all([
    fetchAllItems('is:pr', DEFAULT_USER),
    fetchAllItems('is:issue', DEFAULT_USER),
  ])

  const hydratedPullRequests = await hydratePullRequests(pullRequests)

  const payload = {
    username: DEFAULT_USER,
    generatedAt: new Date().toISOString(),
    pullRequests: hydratedPullRequests,
    issues,
  }

  await writeFile('public/data.json', `${JSON.stringify(payload, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
import { writeFile } from 'node:fs/promises'
