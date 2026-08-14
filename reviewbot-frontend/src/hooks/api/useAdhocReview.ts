import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { apiClient } from '@/api/client';
import { useToast } from '@/components/ToastProvider';

export type AdhocStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type AdhocMode = 'review' | 'fix';

export interface AdhocIssue {
  line: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: 'security' | 'performance' | 'logic' | 'style';
  message: string;
  suggestion: string;
}

export interface AdhocChange {
  description: string;
}

export interface AdhocReview {
  id: string;
  batchId?: string | null;
  fileName: string;
  language: string;
  code?: string;
  mode: AdhocMode;
  status: AdhocStatus;
  topic?: string | null;
  summary?: string | null;
  recommendation?: string | null;
  issues?: AdhocIssue[] | null;
  fixedCode?: string | null;
  changes?: AdhocChange[] | null;
  score?: number | null;
  errorMessage?: string | null;
  createdAt: string;
}

export interface AdhocBatchSummary {
  batchId: string;
  status: AdhocStatus;
  overallScore: number | null;
  overallBrief: string | null;
  fileCount: number;
}

export interface AdhocBatch {
  batchId: string;
  reviews: AdhocReview[];
  summary?: AdhocBatchSummary | null;
}

export const useSubmitPastedCode = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { fileName: string; code: string; mode: AdhocMode }) => {
      const { data } = await apiClient.post<AdhocReview>('/api/adhoc-reviews', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adhoc-reviews'] });
    },
  });
};

export const useSubmitFileUpload = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, mode }: { file: File; mode: AdhocMode }) => {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await apiClient.post<AdhocReview | AdhocBatch>(
        `/api/adhoc-reviews/upload?mode=${mode}`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adhoc-reviews'] });
    },
  });
};

export const useRecentAdhocReviews = () => {
  return useQuery({
    queryKey: ['adhoc-reviews'],
    queryFn: async () => {
      const { data } = await apiClient.get<AdhocReview[]>('/api/adhoc-reviews');
      return data;
    },
    refetchInterval: 10000,
  });
};

export interface GeminiUsage {
  used: number;
  limit: number;
  date: string;
}

/** Powers the "X/20 reviews used today" indicator - checked before hitting
 * the free tier's daily quota wall instead of only finding out mid-batch. */
export const useGeminiUsage = () => {
  return useQuery({
    queryKey: ['gemini-usage'],
    queryFn: async () => {
      const { data } = await apiClient.get<GeminiUsage>('/api/adhoc-reviews/usage');
      return data;
    },
    refetchInterval: 15000,
  });
};

export const useDeleteAdhocReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/api/adhoc-reviews/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adhoc-reviews'] });
    },
  });
};

export const useDeleteAdhocBatch = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (batchId: string) => {
      await apiClient.delete(`/api/adhoc-reviews/batch/${batchId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['adhoc-reviews'] });
    },
  });
};

/**
 * Polls a single ad-hoc review's status every 1.5s until it reaches
 * COMPLETED or FAILED (or polling is stopped by setting id to null).
 */
export const usePollAdhocReview = (id: string | null) => {
  const [review, setReview] = useState<AdhocReview | null>(null);
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { showToast } = useToast();
  const notifiedRef = useRef(false);

  useEffect(() => {
    notifiedRef.current = false;
  }, [id]);

  useEffect(() => {
    if (!id) {
      setReview(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const { data } = await apiClient.get<AdhocReview>(`/api/adhoc-reviews/${id}`);
        if (cancelled) return;
        setReview(data);
        if (data.status === 'COMPLETED' || data.status === 'FAILED') {
          if (intervalRef.current) clearInterval(intervalRef.current);
          queryClient.invalidateQueries({ queryKey: ['adhoc-reviews'] });
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            showToast(
              data.status === 'COMPLETED' ? `Review of ${data.fileName} is ready` : `Review of ${data.fileName} failed`,
              data.status === 'COMPLETED' ? 'success' : 'error',
            );
          }
        }
      } catch (err: any) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        // A stale/deleted id (e.g. left over from a database reset during
        // development) - stop polling and clear it so we fall back to the
        // composer instead of spinning forever.
        if (err?.response?.status === 404) {
          sessionStorage.removeItem('codebuddy:review-active-id');
          setReview(null);
        }
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 1500);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [id, queryClient, showToast]);

  return review;
};

/**
 * Polls every review in a zip-upload batch until all are COMPLETED/FAILED,
 * and also polls the overall batch summary (score + AI project brief)
 * until it's ready (it finishes slightly after the last file, since it's
 * synthesized from all of them).
 */
export const usePollAdhocBatch = (batchId: string | null) => {
  const [reviews, setReviews] = useState<AdhocReview[]>([]);
  const [summary, setSummary] = useState<AdhocBatchSummary | null>(null);
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { showToast } = useToast();
  const notifiedRef = useRef(false);

  useEffect(() => {
    notifiedRef.current = false;
  }, [batchId]);

  useEffect(() => {
    if (!batchId) {
      setReviews([]);
      setSummary(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const { data } = await apiClient.get<AdhocBatch>(`/api/adhoc-reviews/batch/${batchId}`);
        if (cancelled) return;
        setReviews(data.reviews);
        setSummary(data.summary || null);
        const filesDone = data.reviews.every((r) => r.status === 'COMPLETED' || r.status === 'FAILED');
        const summaryDone = !data.summary || data.summary.status === 'COMPLETED' || data.summary.status === 'FAILED';
        if (filesDone && summaryDone) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          queryClient.invalidateQueries({ queryKey: ['adhoc-reviews'] });
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            showToast(`Zip review finished — ${data.reviews.length} file(s) done`, 'success');
          }
        }
      } catch (err: any) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (err?.response?.status === 404) {
          sessionStorage.removeItem('codebuddy:review-active-batch');
          setReviews([]);
          setSummary(null);
        }
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 1500);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [batchId, queryClient, showToast]);

  return { reviews, summary };
};
