import { Module } from '@nestjs/common';
import { AdhocReviewController } from './adhoc-review.controller';
import { AdhocReviewService } from './adhoc-review.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [PrismaModule, LlmModule],
  controllers: [AdhocReviewController],
  providers: [AdhocReviewService],
})
export class AdhocReviewModule {}
