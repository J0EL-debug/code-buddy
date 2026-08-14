import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, GitMerge, AlertCircle, CheckCircle, Clock, XCircle } from 'lucide-react';
import { useReviews } from '@/hooks/api/useReviews';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';
import type { ReviewStatus, Review } from '@/types';

const getStatusConfig = (status: ReviewStatus) => {
  switch (status) {
    case 'COMPLETED':
      return {
        icon: <CheckCircle className="h-4 w-4" />,
        label: 'Completed',
        variant: 'success' as const,
      };
    case 'PROCESSING':
      return {
        icon: <Clock className="h-4 w-4" />,
        label: 'Processing',
        variant: 'warning' as const,
      };
    case 'PENDING':
      return {
        icon: <Clock className="h-4 w-4" />,
        label: 'Pending',
        variant: 'default' as const,
      };
    case 'FAILED':
      return {
        icon: <XCircle className="h-4 w-4" />,
        label: 'Failed',
        variant: 'destructive' as const,
      };
    case 'SKIPPED':
      return {
        icon: <AlertCircle className="h-4 w-4" />,
        label: 'Skipped',
        variant: 'secondary' as const,
      };
  }
};

export const RecentReviews = () => {
  const [page] = useState(1);
  const { data: reviewsData, isLoading, error } = useReviews({ page, limit: 5 });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 shadow-none dark:border-border dark:bg-card">
        <div className="h-96 animate-pulse rounded-lg bg-secondary dark:bg-secondary" />
      </div>
    );
  }

  if (error || !reviewsData) {
    return (
      <div className="rounded-xl border border-error-200 bg-error-50 p-6 dark:border-error-800 dark:bg-error-900/20">
        <p className="text-sm text-error-600 dark:text-error-400">
          Failed to load recent reviews. Please try again.
        </p>
      </div>
    );
  }

  const reviews = reviewsData?.data || [];

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-none dark:border-border dark:bg-card">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground dark:text-primary-foreground">Recent Reviews</h3>
          <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground">
            Latest code review activities
          </p>
        </div>
        <Link
          to="/reviews"
          className="text-sm font-medium text-primary hover:text-primary dark:hover:text-brand-400"
        >
          View all
        </Link>
      </div>

      <div className="space-y-4">
        {reviews?.map((review: Review) => {
          const statusConfig = getStatusConfig(review?.status || 'PENDING');

          return (
            <div
              key={review?.id || Math.random()}
              className="rounded-lg border border-border p-4 transition hover:border-brand-300 dark:border-border dark:hover:border-brand-700"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 bg-primary/10">
                  <GitMerge className="h-5 w-5 text-primary dark:text-brand-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium text-foreground dark:text-primary-foreground truncate">
                        {review?.title || 'Untitled Review'}
                      </h4>
                      <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground">
                        <span className="truncate">
                          {review?.project?.namespace || 'unknown'}/{review?.project?.name || 'unknown'}
                        </span>
                        <span>•</span>
                        <span>!{review?.mergeRequestIid || 0}</span>
                        {review?.developer?.username && (
                          <>
                            <span>•</span>
                            <span>@{review.developer.username}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {review?.sourceUrl && (
                      <a
                        href={review.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-primary dark:hover:text-brand-400"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <Badge variant={statusConfig?.variant || 'default'}>
                      <div className="flex items-center gap-1">
                        {statusConfig?.icon}
                        {statusConfig?.label}
                      </div>
                    </Badge>

                    {review?.qualityScore !== null && review?.qualityScore !== undefined && (
                      <div className="flex items-center gap-1 text-sm">
                        <span className="text-muted-foreground dark:text-muted-foreground">Score:</span>
                        <span className="font-semibold text-foreground dark:text-primary-foreground">
                          {review.qualityScore.toFixed(1)}
                        </span>
                      </div>
                    )}

                    {(review?.issuesFound ?? 0) > 0 && (
                      <div className="flex items-center gap-1 text-sm">
                        <AlertCircle className="h-4 w-4 text-warning-500" />
                        <span className="font-medium text-foreground dark:text-gray-300">
                          {review.issuesFound} {review.issuesFound === 1 ? 'issue' : 'issues'}
                        </span>
                      </div>
                    )}

                    {review?.createdAt && (
                      <span className="ml-auto text-xs text-muted-foreground dark:text-muted-foreground">
                        {format(parseISO(review.createdAt), 'MMM dd, HH:mm')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
