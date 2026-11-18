function Bar({ className = '' }) {
  return <span className={`skeleton-block ${className}`} aria-hidden="true" />
}

export function FeedSkeleton({ count = 3 }) {
  return <div className="skeleton-feed" role="status" aria-label="Loading feed">
    {Array.from({ length: count }, (_, index) => <article className="skeleton-feed-card" key={index}>
      <div className="skeleton-feed-heading"><Bar className="skeleton-avatar" /><div><Bar className="skeleton-line skeleton-name" /><Bar className="skeleton-line skeleton-short" /></div></div>
      <Bar className="skeleton-feed-image" />
      <div className="skeleton-feed-copy"><Bar className="skeleton-line" /><Bar className="skeleton-line skeleton-copy-short" /></div>
    </article>)}
    <span className="sr-only">Loading member posts…</span>
  </div>
}

export function PostGridSkeleton({ count = 6 }) {
  return <div className="posts-grid skeleton-post-grid" role="status" aria-label="Loading posts">
    {Array.from({ length: count }, (_, index) => <article className="post-card skeleton-post-card" key={index}>
      <Bar className="skeleton-post-image" />
      <div className="post-card-info"><Bar className="skeleton-line" /><Bar className="skeleton-line skeleton-copy-short" /></div>
    </article>)}
    <span className="sr-only">Loading posts…</span>
  </div>
}

export function TableSkeleton({ rows = 6 }) {
  return <div className="table-scroll skeleton-table" role="status" aria-label="Loading members">
    <table className="users-table"><thead><tr>{['Member', 'Phone', 'Education', 'Location', 'Church / organization', 'Status', 'Actions'].map(label => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{Array.from({ length: rows }, (_, index) => <tr key={index}><td><div className="skeleton-member-cell"><Bar className="skeleton-avatar" /><div><Bar className="skeleton-line skeleton-name" /><Bar className="skeleton-line skeleton-short" /></div></div></td>{Array.from({ length: 5 }, (_, cell) => <td key={cell}><Bar className="skeleton-line" /></td>)}<td><Bar className="skeleton-line skeleton-action" /></td></tr>)}</tbody>
    </table>
    <span className="sr-only">Loading members…</span>
  </div>
}

export function ProfileSkeleton() {
  return <div className="skeleton-profile" role="status" aria-label="Loading profile">
    <Bar className="skeleton-profile-avatar" />
    <div className="skeleton-profile-copy"><Bar className="skeleton-line skeleton-title" /><Bar className="skeleton-line skeleton-medium" /><Bar className="skeleton-line" /><Bar className="skeleton-line skeleton-short" /></div>
    <span className="sr-only">Loading profile…</span>
  </div>
}

export function PageSkeleton() {
  return <main className="page skeleton-page" role="status" aria-label="Loading page"><Bar className="skeleton-line skeleton-title" /><Bar className="skeleton-line skeleton-medium" /><span className="sr-only">Loading…</span></main>
}
