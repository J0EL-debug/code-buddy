import { Injectable, Logger } from '@nestjs/common';
import PQueue from 'p-queue';
import { ReviewProcessor, ReviewJobData } from './review-processor';

/**
 * Review Queue Service
 * In-memory replacement for the old Bull/Redis queue. Reviews are processed
 * asynchronously in this same Node process, with a small concurrency limit
 * so multiple webhook events don't overwhelm the LLM/GitHub APIs at once.
 *
 * This trades away cross-process/durable job persistence (what Redis+Bull
 * gave us) for a zero-infrastructure setup — fine for a single-instance
 * deployment, and there's nothing to install or run alongside the app.
 */
@Injectable()
export class ReviewQueueService {
  private readonly logger = new Logger(ReviewQueueService.name);
  private readonly queue = new PQueue({ concurrency: 2 });

  constructor(private readonly reviewProcessor: ReviewProcessor) {}

  /**
   * Enqueue a review job for background processing.
   * Returns immediately; the job runs asynchronously.
   */
  async add(jobName: 'process-review', data: ReviewJobData): Promise<{ id: string }> {
    const jobId = `${data.reviewId}-${Date.now()}`;

    this.queue
      .add(() => this.reviewProcessor.handleReview(data))
      .catch((error) => {
        this.logger.error(`Job ${jobId} failed: ${error?.message ?? error}`);
      });

    return { id: jobId };
  }
}
