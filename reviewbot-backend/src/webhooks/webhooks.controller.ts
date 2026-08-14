import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { GitHubWebhookGuard } from '../common/guards/github-webhook.guard';

/**
 * Webhooks Controller
 * Handles incoming GitHub webhook requests
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * GitHub webhook endpoint
   * Receives and processes pull_request events
   * @param event GitHub event type (from X-GitHub-Event header)
   * @param payload Webhook payload
   * @returns Processing result
   */
  @Post('github')
  @HttpCode(200)
  @UseGuards(GitHubWebhookGuard)
  async handleGitHubWebhook(
    @Headers('x-github-event') event: string,
    @Body() payload: any,
  ) {
    this.logger.log(`Received GitHub webhook: ${event}`);

    if (event === 'issue_comment') {
      try {
        const result = await this.webhooksService.processComment(payload);
        if (!result) {
          return { success: true, message: 'Comment not a recheck request' };
        }
        return {
          success: true,
          message: 'Recheck triggered',
          reviewId: result.id,
          prNumber: result.mergeRequestIid,
        };
      } catch (error) {
        this.logger.error('Failed to process comment webhook:', error);
        throw error;
      }
    }

    // Only process pull_request events beyond this point
    if (event !== 'pull_request') {
      this.logger.log(`Ignoring non-PR event: ${event}`);
      return {
        success: true,
        message: 'Event type not processed',
        event,
      };
    }

    // Validate payload structure
    if (!payload.pull_request || !payload.repository) {
      throw new BadRequestException('Invalid webhook payload structure');
    }

    try {
      const result = await this.webhooksService.processPullRequest(payload);

      if (!result) {
        return {
          success: true,
          message: 'Pull request skipped (draft or closed)',
          prNumber: payload.pull_request.number,
        };
      }

      return {
        success: true,
        message: 'Webhook processed successfully',
        reviewId: result.id,
        prNumber: result.mergeRequestIid,
        status: result.status,
      };
    } catch (error) {
      this.logger.error('Failed to process webhook:', error);
      throw error;
    }
  }

  /**
   * Health check endpoint for webhook
   * @returns Health status
   */
  @Post('github/health')
  @HttpCode(200)
  async healthCheck() {
    return {
      success: true,
      message: 'Webhook endpoint is healthy',
      timestamp: new Date().toISOString(),
    };
  }
}
