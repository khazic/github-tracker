const DEFAULT_USER = 'khazic'
const PAGE_SIZE = 100
const MAX_PAGES = 3
const GITHUB_API = 'https://api.github.com'
const CACHE_KEY = 'https://github-tracker-cache.internal/data'
const CACHE_TTL_SECONDS = 3600

function githubHeaders(env) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'khazic-github-tracker-worker',
  }

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`
  }

  return headers
}

async function githubFetch(path, env) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(env),
  })

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${path}`)
  }

  return response.json()
}

async function searchGithub(query, page, env) {
  const params = new URLSearchParams({
    q: query,
    sort: 'updated',
    order: 'desc',
    per_page: PAGE_SIZE.toString(),
    page: page.toString(),
  })

  return githubFetch(`/search/issues?${params}`, env)
}

async function fetchAllItems(kind, username, env) {
  const query = `${kind} author:${username} archived:false`
  const items = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const payload = await searchGithub(query, page, env)
    items.push(...payload.items)

    if (payload.items.length < PAGE_SIZE) {
      break
    }
  }

  return items
}

async function fetchPullRequestDetail(ownerRepo, number, env) {
  return githubFetch(`/repos/${ownerRepo}/pulls/${number}`, env)
}

async function hydratePullRequests(items, env) {
  return Promise.all(
    items.map(async (item) => {
      const ownerRepo = item.repository_url.replace('https://api.github.com/repos/', '')
      const detail = await fetchPullRequestDetail(ownerRepo, item.number, env)
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

async function buildPayload(env) {
  const username = env.GITHUB_USERNAME || DEFAULT_USER
  const [pullRequests, issues] = await Promise.all([
    fetchAllItems('is:pr', username, env),
    fetchAllItems('is:issue', username, env),
  ])

  return {
    username,
    generatedAt: new Date().toISOString(),
    pullRequests: await hydratePullRequests(pullRequests, env),
    issues,
  }
}

async function readCache() {
  const cache = caches.default
  const request = new Request(CACHE_KEY)
  const response = await cache.match(request)
  return response ?? null
}

async function writeCache(payload) {
  const cache = caches.default
  const request = new Request(CACHE_KEY)
  const response = new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_TTL_SECONDS}`,
      'access-control-allow-origin': '*',
    },
  })
  await cache.put(request, response.clone())
  return response
}

async function handleApi(request, env) {
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get('refresh') === '1'

  if (!forceRefresh) {
    const cached = await readCache()
    if (cached) {
      return cached
    }
  }

  const payload = await buildPayload(env)
  return writeCache(payload)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      })
    }

    if (url.pathname === '/tracker') {
      return handleApi(request, env)
    }

    return new Response('Not found', { status: 404 })
  },

  async scheduled(_event, env) {
    const payload = await buildPayload(env)
    await writeCache(payload)
  },
}
