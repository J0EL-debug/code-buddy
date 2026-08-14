import { Module } from '@nestjs/common';
import { ReviewProcessor } from './review-processor';
import { ReviewQueueService } from './review-queue.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../llm/llm.module';
import { GitHubModule } from '../github/github.module';

@Module({
  imports: [
    // Dependencies
    PrismaModule,
    LlmModule,
    GitHubModule,
  ],
  providers: [ReviewProcessor, ReviewQueueService],
  exports: [ReviewQueueService],
})
export class QueueModule {}
