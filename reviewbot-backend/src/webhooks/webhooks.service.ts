import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReviewQueueService } from '../queue/review-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import { PullRequestEventDto } from './dto/pull-request-event.dto';
import { ReviewStatus } from '@prisma/client';

const RECHECK_TRIGGER = '/codebuddy recheck';

/**
 * Webhooks Service
 * Handles processing of GitHub webhook events
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private reviewQueue: ReviewQueueService,
  ) {}

  private async upsertProject(repository: { id: number; name: string; owner: { login: string } }) {
    return this.prisma.project.upsert({
      where: { githubRepoId: repository.id },
      update: {
        name: repository.name,
        namespace: repository.owner.login,
        updatedAt: new Date(),
      },
      create: {
        githubRepoId: repository.id,
        name: repository.name,
        namespace: repository.owner.login,
        webhookSecret: this.configService.get<string>('GITHUB_WEBHOOK_SECRET') || 'default_secret',
        isActive: true,
      },
    });
  }

  private async upsertDeveloper(user: { id: number; login: string; avatar_url?: string }) {
    return this.prisma.developer.upsert({
      where: { username: user.login },
      update: {
        githubUserId: user.id,
        avatarUrl: user.avatar_url,
        updatedAt: new Date(),
      },
      create: {
        githubUserId: user.id,
        username: user.login,
        name: user.login,
        avatarUrl: user.avatar_url,
      },
    });
  }

  /**
   * Process GitHub pull_request webhook event
   * Creates or updates project, developer, and review records
   * @param payload GitHub webhook payload
   * @returns Created review record or null if skipped
   */
  async processPullRequest(payload: PullRequestEventDto) {
    const { pull_request: pr, repository, action } = payload;

    // Skip draft PRs
    if (pr.draft) {
      this.logger.log(`Skipping draft PR #${pr.number} in ${repository.name}`);
      return null;
    }

    // Skip closed/merged PRs (only process opened/updated/reopened)
    if (!['opened', 'synchronize', 'reopened'].includes(action)) {
      this.logger.log(`Skipping PR #${pr.number} with action: ${action}`);
      return null;
    }

    this.logger.log(`Processing PR #${pr.number} from ${repository.name}`);

    try {
      // Use transaction for atomicity
      const result = await this.prisma.$transaction(async (tx) => {
        const projectRecord = await this.upsertProject(repository);
        const developerRecord = await this.upsertDeveloper(pr.user);

        // Check if review already exists for this PR
        const existingReview = await tx.review.findFirst({
          where: {
            mergeRequestId: pr.id,
            projectId: projectRecord.id,
          },
        });

        if (existingReview) {
          this.logger.log(`Review already exists for PR #${pr.number}, skipping creation`);
          return { review: existingReview, projectId: projectRecord.id, isNew: false };
        }

        // Create new review record
        const review = await tx.review.create({
          data: {
            mergeRequestId: pr.id,
            mergeRequestIid: pr.number,
            projectId: projectRecord.id,
            developerId: developerRecord.id,
            title: pr.title,
            description: pr.body || '',
            sourceUrl: pr.html_url,
            targetBranch: pr.base.ref,
            sourceBranch: pr.head.ref,
            status: ReviewStatus.PENDING,
            reviewContent: {},
          },
        });

        this.logger.log(`✓ Created review ${review.id} for PR #${pr.number}`);

        return { review, projectId: projectRecord.id, isNew: true };
      });

      if (!result.isNew) {
        return result.review;
      }

      await this.enqueueReview(result.review.id, result.projectId, repository.owner.login, repository.name, pr.number);

      return result.review;
    } catch (error) {
      this.logger.error(`Failed to process PR #${pr.number}:`, error);
      throw error;
    }
  }

  /**
   * Process a GitHub issue_comment webhook event, looking for a
   * "/codebuddy recheck" command on a PR. Unlike processPullRequest, this
   * always creates a fresh review (rather than skipping if one already
   * exists) since the whole point is re-reviewing after the author says
   * they've made changes.
   */
  async processComment(payload: any) {
    const { action, comment, issue, repository } = payload;

    if (action !== 'created') return null;
    if (!issue?.pull_request) {
      this.logger.debug('Comment is on a plain issue, not a PR - ignoring');
      return null;
    }

    const body = (comment?.body || '').trim().toLowerCase();
    if (body !== RECHECK_TRIGGER) {
      return null; // not our trigger phrase - ignore silently
    }

    const prNumber = issue.number;
    this.logger.log(`Recheck requested via comment on PR #${prNumber} in ${repository.name}`);

    const projectRecord = await this.upsertProject(repository);
    const developerRecord = await this.upsertDeveloper(comment.user);

    // Fetch current PR details so the new review has accurate branch info
    // (the comment payload itself doesn't include the full PR object).
    const review = await this.prisma.review.create({
      data: {
        mergeRequestId: issue.id,
        mergeRequestIid: prNumber,
        projectId: projectRecord.id,
        developerId: developerRecord.id,
        title: issue.title || `PR #${prNumber}`,
        description: '',
        sourceUrl: issue.html_url || '',
        targetBranch: '',
        sourceBranch: '',
        status: ReviewStatus.PENDING,
        reviewContent: {},
      },
    });

    this.logger.log(`✓ Created recheck review ${review.id} for PR #${prNumber}`);

    await this.enqueueReview(review.id, projectRecord.id, repository.owner.login, repository.name, prNumber);

    return review;
  }

  private async enqueueReview(reviewId: string, projectId: string, owner: string, repo: string, prNumber: number) {
    try {
      this.logger.log(`Attempting to queue review ${reviewId} for AI processing...`);

      const job = await this.reviewQueue.add('process-review', {
        reviewId,
        projectId,
        owner,
        repo,
        prNumber,
      });

      this.logger.log(`✓ Successfully queued review ${reviewId} with job ID: ${job.id}`);
    } catch (queueError) {
      this.logger.error(`Failed to queue review ${reviewId} for processing:`, queueError);
      // Don't throw - review was created successfully, just queuing failed
    }
  }
}
