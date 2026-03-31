import { useEffect, useMemo, useState } from 'react'
import './App.css'

const DEFAULT_USER = 'khazic'
const PAGE_SIZE = 100
const MAX_PAGES = 3
const DEFAULT_THEME = 'dark'

function formatDate(dateString) {
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateString))
}

function formatRelative(dateString) {
  const diffMs = new Date(dateString).getTime() - Date.now()
  const diffHours = Math.round(diffMs / (1000 * 60 * 60))
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }

  return formatter.format(Math.round(diffHours / 24), 'day')
}

async function searchGithub(query, page) {
  const params = new URLSearchParams({
    q: query,
    sort: 'updated',
    order: 'desc',
    per_page: PAGE_SIZE.toString(),
    page: page.toString(),
  })

  const response = await fetch(`https://api.github.com/search/issues?${params}`)

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('GitHub API rate limit hit. Wait a bit and retry.')
    }

    if (response.status === 422) {
      throw new Error('GitHub search query failed. Check the username and try again.')
    }

    throw new Error(`GitHub API request failed with status ${response.status}.`)
  }

  return response.json()
}

async function fetchPullRequestDetail(ownerRepo, number) {
  const response = await fetch(`https://api.github.com/repos/${ownerRepo}/pulls/${number}`)

  if (!response.ok) {
    throw new Error(`GitHub pull request detail request failed with status ${response.status}.`)
  }

  return response.json()
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

async function hydratePullRequests(items) {
  return Promise.all(
    items.map(async (item) => {
      const ownerRepo = item.repository_url.replace('https://api.github.com/repos/', '')
      const detail = await fetchPullRequestDetail(ownerRepo, item.number)
      const derivedState = detail.merged_at ? 'merged' : item.state

      return {
        ...item,
        derivedState,
        merged_at: detail.merged_at,
      }
    }),
  )
}

function buildRepoGroups(items) {
  const groups = new Map()

  for (const item of items) {
    const fullName = item.repository_url.replace('https://api.github.com/repos/', '')
    const current = groups.get(fullName) ?? {
      repo: fullName,
      open: 0,
      closed: 0,
      merged: 0,
      updatedAt: item.updated_at,
      items: [],
    }

    current[item.derivedState ?? item.state] += 1
    current.updatedAt =
      new Date(item.updated_at) > new Date(current.updatedAt) ? item.updated_at : current.updatedAt
    current.items.push(item)
    groups.set(fullName, current)
  }

  return Array.from(groups.values()).sort(
    (left, right) => new Date(right.updatedAt) - new Date(left.updatedAt),
  )
}

function buildStats(items) {
  return items.reduce(
    (acc, item) => {
      acc.total += 1
      acc[item.derivedState ?? item.state] += 1
      return acc
    },
    { total: 0, open: 0, closed: 0, merged: 0 },
  )
}

function Section({ title, items, filter, setFilter, groups, searchType, includeMerged = false }) {
  const [expandedRepos, setExpandedRepos] = useState({})
  const filterOptions = includeMerged ? ['all', 'open', 'merged', 'closed'] : ['all', 'open', 'closed']

  function toggleRepo(repo) {
    setExpandedRepos((current) => ({
      ...current,
      [repo]: !current[repo],
    }))
  }

  return (
    <section className="panel section-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">{title}</p>
          <h2>{items.length} items</h2>
        </div>
        <div className="segmented-control" role="tablist" aria-label={`${title} status filter`}>
          {filterOptions.map((status) => (
            <button
              key={status}
              type="button"
              className={filter === status ? 'active' : ''}
              onClick={() => setFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="repo-list">
        {groups.length === 0 ? (
          <div className="empty-state">No items match this filter.</div>
        ) : (
          groups.map((group) => (
            <article key={group.repo} className="repo-card">
              <button type="button" className="repo-card__header repo-toggle" onClick={() => toggleRepo(group.repo)}>
                <div>
                  <h3>{group.repo}</h3>
                  <p>
                    {group.items.length} items · {group.open} open
                    {includeMerged ? ` · ${group.merged} merged` : ''}
                    {' · '}
                    {group.closed} closed
                  </p>
                </div>
                <span className="muted">
                  {expandedRepos[group.repo] ? 'Collapse' : 'Expand'} · Updated {formatRelative(group.updatedAt)}
                </span>
              </button>

              <div className="item-list">
                {group.items.slice(0, expandedRepos[group.repo] ? group.items.length : 5).map((item) => (
                  <a
                    key={item.id}
                    className="item-row"
                    href={item.html_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className={`status-dot ${item.derivedState ?? item.state}`} aria-hidden="true" />
                    <div className="item-copy">
                      <strong>{item.title}</strong>
                      <span>
                        #{item.number} · {item.derivedState ?? item.state} · updated {formatDate(item.updated_at)}
                      </span>
                    </div>
                  </a>
                ))}

                {group.items.length > 5 && !expandedRepos[group.repo] ? (
                  <a
                    className="view-more"
                    href={`https://github.com/${group.repo}/${searchType}?q=author%3A${encodeURIComponent(
                      itemAuthor(group.items[0]),
                    )}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View all {group.items.length} in GitHub
                  </a>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  )
}

function itemAuthor(item) {
  return item.user?.login ?? ''
}

function ThemeToggle({ theme, setTheme }) {
  return (
    <div className="theme-toggle" role="tablist" aria-label="Theme toggle">
      {[
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
      ].map((option) => (
        <button
          key={option.value}
          type="button"
          className={theme === option.value ? 'active' : ''}
          onClick={() => setTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function StatFilterButton({ count, label, active, onClick }) {
  return (
    <button type="button" className={`stat-filter ${active ? 'active' : ''}`} onClick={onClick}>
      <span>{count}</span> {label}
    </button>
  )
}

function App() {
  const [inputValue, setInputValue] = useState(DEFAULT_USER)
  const [username, setUsername] = useState(DEFAULT_USER)
  const [pullRequests, setPullRequests] = useState([])
  const [issues, setIssues] = useState([])
  const [pullRequestFilter, setPullRequestFilter] = useState('all')
  const [issueFilter, setIssueFilter] = useState('all')
  const [repoQuery, setRepoQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(DEFAULT_THEME)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError('')

      try {
        const [prs, issueItems] = await Promise.all([
          fetchAllItems('is:pr', username),
          fetchAllItems('is:issue', username),
        ])
        const hydratedPrs = await hydratePullRequests(prs)

        if (!cancelled) {
          setPullRequests(hydratedPrs)
          setIssues(issueItems)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message)
          setPullRequests([])
          setIssues([])
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [username])

  const filteredPullRequests = useMemo(() => {
    return pullRequests.filter((item) => {
      const state = item.derivedState ?? item.state
      const matchStatus = pullRequestFilter === 'all' || state === pullRequestFilter
      const repo = item.repository_url.replace('https://api.github.com/repos/', '')
      const matchRepo = repo.toLowerCase().includes(repoQuery.toLowerCase())
      return matchStatus && matchRepo
    })
  }, [pullRequests, pullRequestFilter, repoQuery])

  const filteredIssues = useMemo(() => {
    return issues.filter((item) => {
      const matchStatus = issueFilter === 'all' || item.state === issueFilter
      const repo = item.repository_url.replace('https://api.github.com/repos/', '')
      const matchRepo = repo.toLowerCase().includes(repoQuery.toLowerCase())
      return matchStatus && matchRepo
    })
  }, [issues, issueFilter, repoQuery])

  const prStats = useMemo(() => buildStats(pullRequests), [pullRequests])
  const issueStats = useMemo(() => buildStats(issues), [issues])
  const groupedPrs = useMemo(() => buildRepoGroups(filteredPullRequests), [filteredPullRequests])
  const groupedIssues = useMemo(() => buildRepoGroups(filteredIssues), [filteredIssues])

  function handleSubmit(event) {
    event.preventDefault()
    const trimmed = inputValue.trim()

    if (!trimmed) {
      return
    }

    setUsername(trimmed)
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Public GitHub work tracker</p>
          <h1>Track every public PR and issue you started.</h1>
          <p className="lede">
            This page uses GitHub&apos;s public search API to group your authored pull requests and
            issues by repository, with a fast view of open versus closed work.
          </p>
        </div>

        <div className="hero-controls">
          <ThemeToggle theme={theme} setTheme={setTheme} />

          <form className="search-bar" onSubmit={handleSubmit}>
            <label htmlFor="username">GitHub username</label>
            <div className="search-row">
              <input
                id="username"
                value={inputValue}
                onChange={(event) => setInputValue(event.target.value)}
                placeholder="octocat"
                autoComplete="off"
              />
              <button type="submit">Load</button>
            </div>
          </form>
        </div>
      </section>

      <section className="summary-grid">
        <article className="panel stat-card">
          <span className="stat-label">Tracking</span>
          <strong>{username}</strong>
          <p>Public authored activity only</p>
        </article>
        <article className="panel stat-card">
          <span className="stat-label">Pull requests</span>
          <strong>{prStats.total}</strong>
          <div className="stat-actions">
            <StatFilterButton
              count={prStats.open}
              label="open"
              active={pullRequestFilter === 'open'}
              onClick={() => setPullRequestFilter('open')}
            />
            <StatFilterButton
              count={prStats.closed}
              label="closed"
              active={pullRequestFilter === 'closed'}
              onClick={() => setPullRequestFilter('closed')}
            />
            <StatFilterButton
              count={prStats.merged}
              label="merged"
              active={pullRequestFilter === 'merged'}
              onClick={() => setPullRequestFilter('merged')}
            />
            <button
              type="button"
              className={`stat-filter subtle ${pullRequestFilter === 'all' ? 'active' : ''}`}
              onClick={() => setPullRequestFilter('all')}
            >
              view all
            </button>
          </div>
        </article>
        <article className="panel stat-card">
          <span className="stat-label">Issues</span>
          <strong>{issueStats.total}</strong>
          <div className="stat-actions">
            <StatFilterButton
              count={issueStats.open}
              label="open"
              active={issueFilter === 'open'}
              onClick={() => setIssueFilter('open')}
            />
            <StatFilterButton
              count={issueStats.closed}
              label="closed"
              active={issueFilter === 'closed'}
              onClick={() => setIssueFilter('closed')}
            />
            <button
              type="button"
              className={`stat-filter subtle ${issueFilter === 'all' ? 'active' : ''}`}
              onClick={() => setIssueFilter('all')}
            >
              view all
            </button>
          </div>
        </article>
      </section>

      <section className="toolbar panel">
        <div>
          <p className="eyebrow">Filter</p>
          <h2>Repository search</h2>
        </div>
        <input
          value={repoQuery}
          onChange={(event) => setRepoQuery(event.target.value)}
          placeholder="Filter by owner/repo"
          aria-label="Filter by repository"
        />
      </section>

      {loading ? <div className="panel notice">Loading GitHub data...</div> : null}
      {error ? <div className="panel notice error">{error}</div> : null}

      {!loading && !error ? (
        <div className="section-grid">
          <Section
            title="Pull Requests"
            items={filteredPullRequests}
            filter={pullRequestFilter}
            setFilter={setPullRequestFilter}
            groups={groupedPrs}
            searchType="pulls"
            includeMerged
          />
          <Section
            title="Issues"
            items={filteredIssues}
            filter={issueFilter}
            setFilter={setIssueFilter}
            groups={groupedIssues}
            searchType="issues"
          />
        </div>
      ) : null}
    </main>
  )
}

export default App
