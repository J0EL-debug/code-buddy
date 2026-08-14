import { useState } from 'react';
import { MetricsOverview } from '@/features/dashboard/MetricsOverview';
import { QualityTrend } from '@/features/dashboard/QualityTrend';
import { DeveloperLeaderboard } from '@/features/dashboard/DeveloperLeaderboard';
import { RecentReviews } from '@/features/dashboard/RecentReviews';
import { ReviewedProjects } from '@/features/dashboard/ReviewedProjects';
import type { ReviewSource } from '@/hooks/useDashboard';

const SOURCE_OPTIONS: { label: string; value: ReviewSource }[] = [
  { label: 'All reviews', value: 'all' },
  { label: 'GitHub PRs', value: 'github' },
  { label: 'Review Code', value: 'adhoc' },
];

export default function DashboardPage() {
  const [source, setSource] = useState<ReviewSource>('all');

  return (
    <div className="py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-title-lg font-semibold text-foreground dark:text-primary-foreground">Dashboard</h1>
            <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
              Overview of code review metrics and team performance
            </p>
          </div>
          <div className="inline-flex gap-1 rounded-xl border border-border bg-card p-1">
            {SOURCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSource(opt.value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  source === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
        <div className="space-y-6 py-6">
          {/* Metrics Overview */}
          <MetricsOverview source={source} />

          {/* Quality Trend Chart */}
          <QualityTrend source={source} />

          {/* Per-project breakdown - only meaningful for ad-hoc reviews,
              since GitHub projects already have their own page */}
          {source !== 'github' && <ReviewedProjects />}

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Developer Leaderboard */}
            <DeveloperLeaderboard />

            {/* Recent Reviews */}
            <RecentReviews />
          </div>
        </div>
      </div>
    </div>
  );
}
