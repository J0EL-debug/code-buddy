import { TrendingUp, TrendingDown, FileCheck, Target, AlertTriangle } from 'lucide-react';
import { useDashboardStats, type ReviewSource } from '@/hooks/useDashboard';

interface MetricCardProps {
  title: string;
  value: string | number;
  trend?: number;
  icon: React.ReactNode;
  iconBgColor: string;
  iconColor: string;
}

const MetricCard = ({ title, value, trend, icon, iconBgColor, iconColor }: MetricCardProps) => {
  const isPositive = trend !== undefined && trend >= 0;
  const showTrend = trend !== undefined && trend !== 0;

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-none dark:border-border dark:bg-card">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground dark:text-muted-foreground">{title}</p>
          <p className="mt-2 text-title-lg font-semibold text-foreground dark:text-primary-foreground">{value}</p>
          {showTrend && (
            <div className="mt-2 flex items-center gap-1">
              {isPositive ? (
                <TrendingUp className="h-4 w-4 text-success-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-error-500" />
              )}
              <span
                className={`text-sm font-medium ${
                  isPositive ? 'text-success-500' : 'text-error-500'
                }`}
              >
                {isPositive ? '+' : ''}
                {trend.toFixed(1)}%
              </span>
              <span className="text-sm text-muted-foreground dark:text-muted-foreground">vs last period</span>
            </div>
          )}
        </div>
        <div className={`rounded-lg p-3 ${iconBgColor}`}>
          <div className={iconColor}>{icon}</div>
        </div>
      </div>
    </div>
  );
};

export const MetricsOverview = ({ source = 'all' }: { source?: ReviewSource }) => {
  const { data: stats, isLoading, error } = useDashboardStats('week', source);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-xl border border-border bg-secondary dark:border-border dark:bg-secondary"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="rounded-xl border border-error-200 bg-error-50 p-6 dark:border-error-800 dark:bg-error-900/20">
        <p className="text-sm text-error-600 dark:text-error-400">
          Failed to load dashboard metrics. Please try again.
        </p>
      </div>
    );
  }

  const totalIssues = stats.bySeverity.reduce((sum, item) => sum + item.count, 0);

  const metrics = [
    {
      title: 'Total Reviews',
      value: stats.totalReviews.toLocaleString(),
      icon: <FileCheck className="h-6 w-6" />,
      iconBgColor: 'bg-brand-50 bg-primary/10',
      iconColor: 'text-primary',
    },
    {
      title: 'Average Score',
      value: stats.averageScore.toFixed(1),
      icon: <Target className="h-6 w-6" />,
      iconBgColor: 'bg-success-50 dark:bg-success-900/20',
      iconColor: 'text-success-500',
    },
    {
      title: 'Avg Issues per Review',
      value: stats.averageIssues.toFixed(2),
      icon: <AlertTriangle className="h-6 w-6" />,
      iconBgColor: 'bg-warning-50 dark:bg-warning-900/20',
      iconColor: 'text-warning-500',
    },
    {
      title: 'Total Issues Found',
      value: totalIssues.toLocaleString(),
      icon: <AlertTriangle className="h-6 w-6" />,
      iconBgColor: 'bg-error-50 dark:bg-error-900/20',
      iconColor: 'text-error-500',
    },
  ];

  const severityColors = {
    critical: 'bg-error-100 text-error-700 dark:bg-error-900/20 dark:text-error-400',
    high: 'bg-warning-100 text-warning-700 dark:bg-warning-900/20 dark:text-warning-400',
    medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400',
    low: 'bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.title} {...metric} />
        ))}
      </div>

      {stats.bySeverity.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6 shadow-none dark:border-border dark:bg-card">
          <h3 className="mb-4 text-sm font-semibold text-foreground dark:text-primary-foreground">Issues by Severity</h3>
          <div className="flex flex-wrap gap-3">
            {stats.bySeverity.map((item) => (
              <div
                key={item.severity}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 ${
                  severityColors[item.severity]
                }`}
              >
                <span className="text-sm font-medium capitalize">{item.severity}</span>
                <span className="rounded-full bg-card/50 px-2 py-0.5 text-sm font-semibold dark:bg-black/20">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
