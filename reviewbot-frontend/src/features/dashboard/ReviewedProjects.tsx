import { useNavigate } from 'react-router-dom';
import { useReviewedProjects } from '@/hooks/useDashboard';

/**
 * Per-project breakdown for the Dashboard - once someone has reviewed more
 * than one thing (a zip, a snippet, another zip...), a single blended
 * "Average Score" stops being useful. This lists each one separately so
 * you can see "campus_system: 72" vs "booking_system: 85" instead of one
 * mystery number.
 */
export const ReviewedProjects = () => {
  const { data: projects, isLoading } = useReviewedProjects();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="h-32 animate-pulse rounded-lg bg-secondary" />
      </div>
    );
  }

  if (!projects || projects.length === 0) {
    return null;
  }

  const scoreColor = (score: number | null) => {
    if (score === null) return '#8B92A3';
    return score >= 90 ? '#5EEAD4' : score >= 70 ? '#FFB454' : '#FF6B6B';
  };

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h3 className="font-display text-base font-semibold text-foreground mb-1">Reviewed Projects</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        Each upload or snippet reviewed through Review Code, shown separately
      </p>
      <div className="divide-y divide-border">
        {projects.map((p) => (
          <button
            key={p.key}
            onClick={() => navigate('/review')}
            className="flex w-full items-center justify-between py-3 text-left transition-colors hover:bg-secondary/30"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
              <p className="text-xs text-muted-foreground">
                {p.type === 'zip' ? `${p.fileCount} files` : 'single file'} &middot;{' '}
                {new Date(p.createdAt).toLocaleDateString()}
              </p>
            </div>
            {p.status === 'COMPLETED' && p.score !== null ? (
              <span
                className="ml-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                style={{ backgroundColor: `${scoreColor(p.score)}22`, color: scoreColor(p.score) }}
              >
                {p.score}
              </span>
            ) : (
              <span className="ml-3 shrink-0 text-xs text-muted-foreground">{p.status.toLowerCase()}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};
