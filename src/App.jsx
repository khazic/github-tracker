import { useEffect, useMemo, useState } from 'react'
import './App.css'

const DEFAULT_USER = 'khazic'
const READ_STATE_KEY = 'github-tracker-read'

function useReadState() {
  const [readState, setReadState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(READ_STATE_KEY) ?? '{}')
    } catch {
      return {}
    }
  })

  function markRead(itemId, updatedAt) {
    setReadState((prev) => {
      const next = { ...prev, [itemId]: updatedAt }
      localStorage.setItem(READ_STATE_KEY, JSON.stringify(next))
      return next
    })
  }

  function isUnread(item) {
    const lastRead = readState[item.id]
    return !lastRead || item.updated_at > lastRead
  }

  return { markRead, isUnread }
}
const DEFAULT_THEME = 'dark'
const AGE_BASE_YEAR = 1997
const RECENT_LINKS = [
  {
    type: 'Blog',
    title: 'The history of Vision-Language Model development: from image and text alignment to MLLM',
    href: 'https://khazzz1c.notion.site/Khazzz1c-s-Blog-post-151d29780b58801bb2bddd42eb81c73d?source=copy_link',
  },
  {
    type: 'Blog',
    title: 'A brief thought on the location of multimodal coding',
    href: 'https://khazzz1c.notion.site/Khazzz1c-s-Blog-post-151d29780b58801bb2bddd42eb81c73d?source=copy_link',
  },
  {
    type: 'Blog',
    title: 'Some simple thoughts on InternVL3',
    href: 'https://khazzz1c.notion.site/Khazzz1c-s-Blog-post-151d29780b58801bb2bddd42eb81c73d?source=copy_link',
  },
  {
    type: 'Paper',
    title: 'VEPO: Variable Entropy Policy Optimization for Low-Resource Language Foundation Models',
    href: 'https://arxiv.org/abs/2603.19152',
  },
  {
    type: 'Paper',
    title: 'Flatter Tokens are More Valuable for Speculative Draft Model Training',
    href: 'https://arxiv.org/abs/2601.18902',
  },
  {
    type: 'Paper',
    title: 'd²Cache: Accelerating Diffusion-Based LLMs via Dual Adaptive Caching',
    href: 'https://arxiv.org/abs/2509.23094',
  },
]

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

async function fetchTrackerData() {
  let workerEndpoint = ''

  try {
    const configResponse = await fetch('/github-tracker/worker-config.json', { cache: 'no-store' })
    if (configResponse.ok) {
      const config = await configResponse.json()
      workerEndpoint = config.endpoint ?? ''
    }
  } catch {
    workerEndpoint = ''
  }

  if (workerEndpoint) {
    try {
      const workerResponse = await fetch(`${workerEndpoint.replace(/\/$/, '')}/tracker`, {
        cache: 'no-store',
      })

      if (workerResponse.ok) {
        return workerResponse.json()
      }
    } catch {
      // Fall back to the latest static snapshot.
    }
  }

  const snapshotResponse = await fetch('/github-tracker/data.json', { cache: 'no-store' })

  if (!snapshotResponse.ok) {
    throw new Error(`Failed to load tracker data: ${snapshotResponse.status}`)
  }

  return snapshotResponse.json()
}

function buildRepoGroups(items) {
  const groups = new Map()

  for (const item of items) {
    const fullName = item.repository_url.replace('https://api.github.com/repos/', '')
    const current = groups.get(fullName) ?? {
      repo: fullName,
      open: 0,
      draft: 0,
      closed: 0,
      merged: 0,
      closed_unmerged: 0,
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
    { total: 0, open: 0, draft: 0, closed: 0, merged: 0, closed_unmerged: 0 },
  )
}

function buildContributionBoard(pullRequests, issues) {
  const board = new Map()

  for (const item of pullRequests) {
    const repo = item.repository_url.replace('https://api.github.com/repos/', '')
    const current = board.get(repo) ?? { repo, prs: 0, issues: 0, updatedAt: item.updated_at }
    current.prs += 1
    current.updatedAt =
      new Date(item.updated_at) > new Date(current.updatedAt) ? item.updated_at : current.updatedAt
    board.set(repo, current)
  }

  for (const item of issues) {
    const repo = item.repository_url.replace('https://api.github.com/repos/', '')
    const current = board.get(repo) ?? { repo, prs: 0, issues: 0, updatedAt: item.updated_at }
    current.issues += 1
    current.updatedAt =
      new Date(item.updated_at) > new Date(current.updatedAt) ? item.updated_at : current.updatedAt
    board.set(repo, current)
  }

  const rows = Array.from(board.values()).sort(
    (left, right) =>
      right.prs + right.issues - (left.prs + left.issues) ||
      new Date(right.updatedAt) - new Date(left.updatedAt),
  )

  const maxPrs = Math.max(1, ...rows.map((row) => row.prs))
  const maxIssues = Math.max(1, ...rows.map((row) => row.issues))

  return {
    rows,
    maxPrs,
    maxIssues,
  }
}

function ContributionBoard({ board, generatedAt }) {
  const [expanded, setExpanded] = useState(false)
  const [hoveredRepo, setHoveredRepo] = useState('')
  const visibleRows = expanded ? board.rows : board.rows.slice(0, 5)

  return (
    <section className="panel board-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Board</p>
          <h2>Repository contribution map</h2>
        </div>
        <span className="muted">
          {generatedAt ? `Updated ${formatRelative(generatedAt)}` : ''}
        </span>
      </div>

      <div className="board-legend">
        <span><i className="legend-swatch legend-swatch--pr" /> PR</span>
        <span><i className="legend-swatch legend-swatch--issue" /> Issue</span>
      </div>

      <div className="board-chart">
        {board.rows.length === 0 ? (
          <div className="empty-state">No contribution data yet.</div>
        ) : (
          visibleRows.map((row) => {
            const prLevel = row.prs === 0 ? 0 : Math.max(0.08, row.prs / board.maxPrs)
            const issueLevel = row.issues === 0 ? 0 : Math.max(0.08, row.issues / board.maxIssues)

            return (
              <div
                key={row.repo}
                className="board-item"
                onMouseEnter={() => setHoveredRepo(row.repo)}
                onMouseLeave={() => setHoveredRepo('')}
              >
                <a
                  className="board-label"
                  href={`https://github.com/${row.repo}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <strong>{row.repo}</strong>
                  <span>{row.prs + row.issues} total · {formatDate(row.updatedAt)}</span>
                </a>

                <div className="board-bars">
                  <div className="mini-bar-row">
                    <span className="mini-bar-label">PR</span>
                    <div className="mini-bar-track">
                      <div
                        className="mini-bar-fill mini-bar-fill--pr"
                        style={{ '--strength': prLevel }}
                      />
                    </div>
                    <span className="mini-bar-value">{row.prs}</span>
                  </div>

                  <div className="mini-bar-row">
                    <span className="mini-bar-label">Issue</span>
                    <div className="mini-bar-track">
                      <div
                        className="mini-bar-fill mini-bar-fill--issue"
                        style={{ '--strength': issueLevel }}
                      />
                    </div>
                    <span className="mini-bar-value">{row.issues}</span>
                  </div>
                </div>

                {hoveredRepo === row.repo ? (
                  <div className="board-tooltip" role="tooltip">
                    <strong>{row.repo}</strong>
                    <span>PR {row.prs}</span>
                    <span>Issue {row.issues}</span>
                    <span>Updated {formatDate(row.updatedAt)}</span>
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>

      {board.rows.length > 5 ? (
        <button type="button" className="board-toggle" onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'Show less' : `Show ${board.rows.length - 5} more`}
        </button>
      ) : null}
    </section>
  )
}

function Section({ title, items, filter, setFilter, groups, searchType, includeMerged = false, isUnread, markRead }) {
  const [expandedRepos, setExpandedRepos] = useState({})
  const filterOptions = includeMerged
    ? ['all', 'open', 'draft', 'merged', 'closed_unmerged']
    : ['all', 'open', 'closed']

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
                    {includeMerged ? ` · ${group.draft} draft · ${group.merged} merged · ${group.closed_unmerged} closed without merge` : ` · ${group.closed} closed`}
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
                    className={`item-row${isUnread(item) ? '' : ' is-read'}`}
                    href={item.html_url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => markRead(item.id, item.updated_at)}
                  >
                    <span className={`status-dot ${item.derivedState ?? item.state}`} aria-hidden="true" />
                    <div className="item-copy">
                      <strong>{item.title}</strong>
                      <span>
                        #{item.number} · {formatStateLabel(item.derivedState ?? item.state)}
                        {item.mergeable_state ? ` · ${item.mergeable_state}` : ''}
                        {' · '}
                        updated {formatDate(item.updated_at)}
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

function formatStateLabel(state) {
  const labels = {
    open: 'open',
    draft: 'draft',
    merged: 'merged',
    closed: 'closed',
    closed_unmerged: 'closed without merge',
  }

  return labels[state] ?? state
}

function getAttentionReason(item) {
  if (item.derivedState === 'draft') {
    return null
  }

  if (item.derivedState !== 'open') {
    return null
  }

  if (['dirty', 'blocked', 'behind', 'unstable', 'unknown'].includes(item.mergeable_state)) {
    return `merge state: ${item.mergeable_state}`
  }

  const updatedHoursAgo = Math.abs(new Date(item.updated_at).getTime() - Date.now()) / (1000 * 60 * 60)
  if (updatedHoursAgo <= 72) {
    return 'recently updated open PR'
  }

  return null
}

function AttentionSection({ items, isUnread, markRead }) {
  return (
    <section className="panel attention-panel">
      <div className="section-header">
        <div>
          <p className="eyebrow">Actionable</p>
          <h2>Open PRs needing attention</h2>
        </div>
        <span className="muted">{items.length} matched</span>
      </div>
      <div className="attention-list">
        {items.length === 0 ? (
          <div className="empty-state">No open PRs currently match the attention rules.</div>
        ) : (
          items.map((item) => (
            <a
              key={item.id}
              className={`attention-row${isUnread(item) ? '' : ' is-read'}`}
              href={item.html_url}
              target="_blank"
              rel="noreferrer"
              onClick={() => markRead(item.id, item.updated_at)}
            >
              <span className={`status-dot ${item.derivedState ?? item.state}`} aria-hidden="true" />
              <div className="item-copy">
                <strong>{item.title}</strong>
                <span>
                  {item.repository_url.replace('https://api.github.com/repos/', '')} · #
                  {item.number} · {getAttentionReason(item)}
                </span>
              </div>
            </a>
          ))
        )}
      </div>
    </section>
  )
}

function HeroProfile() {
  const displayAge = new Date().getFullYear() - AGE_BASE_YEAR

  return (
    <section className="panel hero-profile">
      <div className="hero-profile__intro">
        <p className="eyebrow">Khazic / public build log</p>
        <h1>LLM trainer by trade. Debugging life in production.</h1>
        <p className="lede">
          Life feels like a bug, but I haven&apos;t rage quit yet. In 2003, I got my first laptop
          ever. Hope we can ride through the best part of life together.
        </p>
      </div>

      <div className="hero-links">
        <a
          href="https://scholar.google.com/citations?user=ntydloAAAAAJ&hl=zh-CN"
          target="_blank"
          rel="noreferrer"
        >
          <span>Academic homepage</span>
          <strong>Google Scholar / khazzz1c</strong>
        </a>
        <a
          href="https://khazzz1c.notion.site/Khazzz1c-s-Blog-post-151d29780b58801bb2bddd42eb81c73d?source=copy_link"
          target="_blank"
          rel="noreferrer"
        >
          <span>Blog</span>
          <strong>Notion / Khazzz1c-s-Blog-post</strong>
        </a>
        <a href="https://x.com/Imkhazzz1c" target="_blank" rel="noreferrer">
          <span>Social</span>
          <strong>X / Imkhazzz1c</strong>
        </a>
      </div>

      <div className="life-card">
        <div className="life-card__header">
          <p className="eyebrow">Life Past</p>
          <span className="muted">still not rage quitting</span>
        </div>
        <p className="life-summary">
          {displayAge}, caffeinated, terminally online, and still trying to turn buggy life into
          shippable code. Big dreams, tiny balance, no rage quit yet.
        </p>
      </div>
    </section>
  )
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

function BackToTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function handleScroll() {
      setVisible(window.scrollY > 320)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  if (!visible) {
    return null
  }

  return (
    <button
      type="button"
      className="back-to-top"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
    >
      Back to top
    </button>
  )
}

function RecentLinks() {
  return (
    <div className="recent-links">
      <p className="eyebrow">Recent</p>
      {RECENT_LINKS.map((item) => (
        <a key={`${item.type}-${item.title}`} href={item.href} target="_blank" rel="noreferrer">
          <span>[{item.type}]</span>
          <strong>{item.title}</strong>
        </a>
      ))}
    </div>
  )
}

function App() {
  const { markRead, isUnread } = useReadState()
  const [pullRequests, setPullRequests] = useState([])
  const [issues, setIssues] = useState([])
  const [pullRequestFilter, setPullRequestFilter] = useState('all')
  const [issueFilter, setIssueFilter] = useState('all')
  const [repoQuery, setRepoQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [generatedAt, setGeneratedAt] = useState('')
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
        const payload = await fetchTrackerData()

        if (!cancelled) {
          setPullRequests(payload.pullRequests ?? [])
          setIssues(payload.issues ?? [])
          setGeneratedAt(payload.generatedAt ?? '')
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
  }, [])

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
  const contributionBoard = useMemo(() => buildContributionBoard(pullRequests, issues), [pullRequests, issues])
  const attentionPullRequests = useMemo(() => {
    return pullRequests
      .filter((item) => getAttentionReason(item))
      .filter((item) =>
        item.repository_url.replace('https://api.github.com/repos/', '').toLowerCase().includes(repoQuery.toLowerCase()),
      )
      .sort((left, right) => new Date(right.updated_at) - new Date(left.updated_at))
      .slice(0, 8)
  }, [pullRequests, repoQuery])

  return (
    <main className="app-shell">
      <BackToTopButton />
      <section className="hero-panel">
        <HeroProfile />

        <div className="hero-controls">
          <ThemeToggle theme={theme} setTheme={setTheme} />
          <section className="panel identity-card">
            <p className="eyebrow">Tracking locked</p>
            <div className="identity-card__user">
              <img className="avatar avatar--large" src="/github-tracker/avatar.jpg" alt="Khazic avatar" />
              <strong>@{DEFAULT_USER}</strong>
            </div>
            <p>
              This site is intentionally scoped to one account only: public PRs, public issues, and
              the ongoing debugging log of one overfit human.
            </p>
            <RecentLinks />
          </section>
        </div>
      </section>

      <section className="summary-grid">
        <article className="panel stat-card">
          <span className="stat-label">Tracking</span>
          <div className="tracking-user">
            <img className="avatar" src="/github-tracker/avatar.jpg" alt="Khazic avatar" />
            <strong>{DEFAULT_USER}</strong>
          </div>
          <p>Public GitHub activity only</p>
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
              count={prStats.draft}
              label="draft"
              active={pullRequestFilter === 'draft'}
              onClick={() => setPullRequestFilter('draft')}
            />
            <StatFilterButton
              count={prStats.closed_unmerged}
              label="closed w/o merge"
              active={pullRequestFilter === 'closed_unmerged'}
              onClick={() => setPullRequestFilter('closed_unmerged')}
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
      {!loading && !error ? <ContributionBoard board={contributionBoard} generatedAt={generatedAt} /> : null}
      {error ? <div className="panel notice error">{error}</div> : null}

      {!loading && !error ? (
        <>
          <AttentionSection items={attentionPullRequests} isUnread={isUnread} markRead={markRead} />
          <div className="section-grid">
            <Section
              title="Pull Requests"
              items={filteredPullRequests}
              filter={pullRequestFilter}
              setFilter={setPullRequestFilter}
              groups={groupedPrs}
              searchType="pulls"
              includeMerged
              isUnread={isUnread}
              markRead={markRead}
            />
            <Section
              title="Issues"
              items={filteredIssues}
              filter={issueFilter}
              setFilter={setIssueFilter}
              groups={groupedIssues}
              searchType="issues"
              isUnread={isUnread}
              markRead={markRead}
            />
          </div>
        </>
      ) : null}
    </main>
  )
}

export default App
