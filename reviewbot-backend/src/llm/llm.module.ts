import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { DiffProcessor } from './diff-processor';
import { IssueVerifier } from './issue-verifier.service';
import { GitHubModule } from '../github/github.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [GitHubModule, PrismaModule],
  providers: [LlmService, DiffProcessor, IssueVerifier],
  exports: [LlmService, DiffProcessor, IssueVerifier],
})
export class LlmModule {}
