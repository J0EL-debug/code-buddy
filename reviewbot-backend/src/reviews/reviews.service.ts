import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/**
 * Reviews Service
 * Handles review queries and aggregation
 */
@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: {
    page: number;
    limit: number;
    projectId?: string;
    developerId?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }) {
    const { page, limit, projectId, developerId, dateFrom, dateTo } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.ReviewWhereInput = {};

    if (projectId) where.projectId = projectId;
    if (developerId) where.developerId = developerId;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = dateFrom;
      if (dateTo) where.createdAt.lte = dateTo;
    }

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          project: { select: { name: true, namespace: true } },
          developer: { select: { username: true, avatarUrl: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    return {
      data: reviews,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const review = await this.prisma.review.findUnique({
      where: { id },
      include: {
        project: {
          select: { name: true, namespace: true, webhookUrl: true },
        },
        developer: {
          select: { username: true, name: true, avatarUrl: true },
        },
        codeChanges: true,
      },
    });

    return review;
  }

  async getStats(timeRange: 'day' | 'week' | 'month' | 'year' = 'week', source: 'all' | 'github' | 'adhoc' = 'all') {
    const dateFrom = this.getDateFrom(timeRange);
    const includeGithub = source !== 'adhoc';
    const includeAdhoc = source !== 'github';

    const stats = includeGithub
      ? await this.prisma.review.aggregate({
          where: { createdAt: { gte: dateFrom } },
          _count: true,
          _avg: { qualityScore: true, issuesFound: true, suggestionsCount: true },
        })
      : { _count: 0, _avg: { qualityScore: 0, issuesFound: 0, suggestionsCount: 0 } };

    const byStatus = includeGithub
      ? await this.prisma.review.groupBy({
          by: ['status'],
          where: { createdAt: { gte: dateFrom } },
          _count: true,
        })
      : [];

    // Get severity distribution from reviewContent JSON
    // Note: The actual query structure depends on your reviewContent JSON format
    const bySeverity = includeGithub
      ? await this.prisma.$queryRaw<Array<{ severity: string; count: bigint }>>`
      SELECT
        json_extract(issue.value, '$.severity') as severity,
        COUNT(*) as count
      FROM review, json_each(json_extract(review_content, '$.issues')) as issue
      WHERE created_at >= ${dateFrom}
        AND json_extract(issue.value, '$.severity') IS NOT NULL
      GROUP BY severity
      ORDER BY count DESC
    `
      : [];

    // Fold in ad-hoc reviews (paste/upload/zip) too, so the dashboard
    // reflects that usage mode as well, not just GitHub PR automation -
    // otherwise it reads as "broken" for anyone only using Review Code.
    const adhocReviews = includeAdhoc
      ? await this.prisma.adhocReview.findMany({
          where: { createdAt: { gte: dateFrom }, status: 'COMPLETED' },
          select: { score: true, issues: true },
        })
      : [];

    const adhocCount = adhocReviews.length;
    const adhocAvgScore = adhocCount > 0
      ? adhocReviews.reduce((sum, r) => sum + (r.score ?? 0), 0) / adhocCount
      : 0;
    const adhocIssueCounts = adhocReviews.map((r) => (Array.isArray(r.issues) ? (r.issues as any[]).length : 0));
    const adhocAvgIssues = adhocCount > 0
      ? adhocIssueCounts.reduce((sum, n) => sum + n, 0) / adhocCount
      : 0;

    const githubCount = stats._count;
    const totalReviews = githubCount + adhocCount;

    const combinedAvgScore = totalReviews > 0
      ? ((stats._avg.qualityScore || 0) * githubCount + adhocAvgScore * adhocCount) / totalReviews
      : 0;
    const combinedAvgIssues = totalReviews > 0
      ? ((stats._avg.issuesFound || 0) * githubCount + adhocAvgIssues * adhocCount) / totalReviews
      : 0;

    const adhocSeverityCounts = new Map<string, number>();
    for (const r of adhocReviews) {
      const issues = Array.isArray(r.issues) ? (r.issues as any[]) : [];
      for (const issue of issues) {
        const sev = issue?.severity;
        if (sev) adhocSeverityCounts.set(sev, (adhocSeverityCounts.get(sev) || 0) + 1);
      }
    }
    const combinedSeverity = new Map<string, number>();
    for (const item of bySeverity) {
      combinedSeverity.set(item.severity, (combinedSeverity.get(item.severity) || 0) + Number(item.count));
    }
    for (const [sev, count] of adhocSeverityCounts) {
      combinedSeverity.set(sev, (combinedSeverity.get(sev) || 0) + count);
    }

    const combinedByStatus = new Map<string, number>();
    for (const item of byStatus) {
      combinedByStatus.set(item.status, (combinedByStatus.get(item.status) || 0) + item._count);
    }
    combinedByStatus.set('COMPLETED', (combinedByStatus.get('COMPLETED') || 0) + adhocCount);

    return {
      totalReviews,
      averageScore: Math.round(combinedAvgScore * 100) / 100,
      averageIssues: Math.round(combinedAvgIssues * 100) / 100,
      averageSuggestions: Math.round((stats._avg.suggestionsCount || 0) * 100) / 100,
      byStatus: Array.from(combinedByStatus.entries()).map(([status, count]) => ({ status, count })),
      bySeverity: Array.from(combinedSeverity.entries()).map(([severity, count]) => ({ severity, count })),
    };
  }

  async getTimeline(params: {
    projectId?: string;
    developerId?: string;
    days?: number;
    source?: 'all' | 'github' | 'adhoc';
  }) {
    const { projectId, developerId, days = 30, source = 'all' } = params;
    const includeGithub = source !== 'adhoc';
    const includeAdhoc = source !== 'github';
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    // Build conditional SQL fragments
    const projectCondition = projectId
      ? Prisma.sql`AND project_id = ${projectId}`
      : Prisma.empty;
    const developerCondition = developerId
      ? Prisma.sql`AND developer_id = ${developerId}`
      : Prisma.empty;

    const timeline = includeGithub
      ? await this.prisma.$queryRaw<
      Array<{
        date: Date;
        reviews: bigint;
        avgScore: number;
        totalIssues: bigint;
      }>
    >`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as reviews,
        AVG(quality_score) as "avgScore",
        SUM(issues_found) as "totalIssues"
      FROM review
      WHERE created_at >= ${dateFrom}
        ${projectCondition}
        ${developerCondition}
      GROUP BY DATE(created_at)
      ORDER BY date
    `
      : [];

    const githubByDate = new Map<string, { reviews: number; scoreSum: number; totalIssues: number }>();
    for (const item of timeline) {
      const key = new Date(item.date).toISOString().slice(0, 10);
      githubByDate.set(key, {
        reviews: Number(item.reviews),
        scoreSum: (item.avgScore || 0) * Number(item.reviews),
        totalIssues: Number(item.totalIssues),
      });
    }

    // Merge in ad-hoc (paste/upload/zip) review activity too, so the trend
    // chart reflects that usage mode - only when there's no project/developer
    // filter, since those are GitHub-specific concepts ad-hoc reviews don't have.
    if (!projectId && !developerId && includeAdhoc) {
      const adhocReviews = await this.prisma.adhocReview.findMany({
        where: { createdAt: { gte: dateFrom }, status: 'COMPLETED' },
        select: { createdAt: true, score: true, issues: true },
      });
      for (const r of adhocReviews) {
        const key = r.createdAt.toISOString().slice(0, 10);
        const issueCount = Array.isArray(r.issues) ? (r.issues as any[]).length : 0;
        const existing = githubByDate.get(key) || { reviews: 0, scoreSum: 0, totalIssues: 0 };
        existing.reviews += 1;
        existing.scoreSum += r.score ?? 0;
        existing.totalIssues += issueCount;
        githubByDate.set(key, existing);
      }
    }

    return Array.from(githubByDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, item]) => ({
        date,
        reviews: item.reviews,
        avgScore: item.reviews > 0 ? Math.round((item.scoreSum / item.reviews) * 100) / 100 : 0,
        totalIssues: item.totalIssues,
      }));
  }

  private getDateFrom(timeRange: string): Date {
    const now = new Date();
    switch (timeRange) {
      case 'day':
        now.setDate(now.getDate() - 1);
        break;
      case 'week':
        now.setDate(now.getDate() - 7);
        break;
      case 'month':
        now.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        now.setFullYear(now.getFullYear() - 1);
        break;
    }
    return now;
  }
}
