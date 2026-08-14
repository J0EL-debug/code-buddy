import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/api/client';
import type { DashboardStats, QualityTrendData, DeveloperStats } from '@/types';

export type ReviewSource = 'all' | 'github' | 'adhoc';

export const useDashboardStats = (timeRange: 'day' | 'week' | 'month' | 'year' = 'week', source: ReviewSource = 'all') => {
  return useQuery({
    queryKey: ['dashboardStats', timeRange, source],
    queryFn: async () => {
      const { data } = await apiClient.get<DashboardStats>('/api/reviews/stats', {
        params: { timeRange, source },
      });
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

export const useQualityTrend = (days: number = 30, source: ReviewSource = 'all') => {
  return useQuery({
    queryKey: ['qualityTrend', days, source],
    queryFn: async () => {
      const { data } = await apiClient.get<QualityTrendData[]>('/api/reviews/timeline', {
        params: { days, source },
      });
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};

export interface ReviewedProject {
  key: string;
  type: 'zip' | 'single';
  name: string;
  score: number | null;
  fileCount: number;
  status: string;
  createdAt: string;
}

export const useReviewedProjects = (limit: number = 20) => {
  return useQuery({
    queryKey: ['reviewedProjects', limit],
    queryFn: async () => {
      const { data } = await apiClient.get<ReviewedProject[]>('/api/adhoc-reviews/projects', {
        params: { limit },
      });
      return data;
    },
    staleTime: 60 * 1000,
  });
};

export const useDeveloperStats = (limit: number = 10) => {
  return useQuery({
    queryKey: ['developerStats', limit],
    queryFn: async () => {
      const { data } = await apiClient.get<DeveloperStats[]>('/api/developers/stats', {
        params: { limit },
      });
      return data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
};
