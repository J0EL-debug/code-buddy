import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes, ApiBody, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdhocReviewService } from './adhoc-review.service';
import { CreateAdhocReviewDto } from './dto/create-adhoc-review.dto';
import { LlmService } from '../llm/llm.service';

/**
 * Ad-hoc Review Controller
 * Lets a signed-in user review code directly through the website - no
 * GitHub repo, PR, or webhook required. Supports pasted code, a single
 * file upload, or a zip of multiple files. Reviews run asynchronously
 * (PENDING -> PROCESSING -> COMPLETED/FAILED); the frontend polls for
 * status the same way a real CI job would be polled.
 */
@ApiTags('Adhoc Review')
@ApiBearerAuth()
@Controller('api/adhoc-reviews')
@UseGuards(JwtAuthGuard)
export class AdhocReviewController {
  constructor(
    private readonly adhocReviewService: AdhocReviewService,
    private readonly llmService: LlmService,
  ) {}

  @Get('usage')
  @ApiOperation({ summary: "Today's Gemini API usage", description: 'How many requests have been made today vs the free-tier daily limit' })
  async getUsage() {
    return this.llmService.getTodayUsage();
  }

  @Post()
  @ApiOperation({ summary: 'Review pasted code', description: 'Submit code directly (JSON body); returns a PENDING row to poll' })
  async reviewPasted(@Body() dto: CreateAdhocReviewDto) {
    return this.adhocReviewService.review(dto.fileName, dto.code, dto.mode || 'review');
  }

  @Post('upload')
  @ApiOperation({ summary: 'Review an uploaded file or zip', description: 'Submit a file or .zip archive (multipart upload)' })
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'mode', enum: ['review', 'fix'], required: false })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async reviewUploaded(
    @UploadedFile() file: Express.Multer.File,
    @Query('mode') mode: 'review' | 'fix' = 'review',
  ) {
    const isZip =
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.originalname.toLowerCase().endsWith('.zip');

    if (isZip) {
      return this.adhocReviewService.reviewZip(file.originalname, file.buffer, mode);
    }

    const code = file.buffer.toString('utf-8');
    return this.adhocReviewService.review(file.originalname, code, mode);
  }

  @Get('projects')
  @ApiOperation({ summary: 'List reviewed "projects" (one row per zip batch or standalone review)' })
  async findProjects() {
    return this.adhocReviewService.findProjects();
  }

  @Get('batch/:batchId')
  @ApiOperation({ summary: 'Get all reviews in a zip-upload batch' })
  async findBatch(@Param('batchId') batchId: string) {
    return this.adhocReviewService.findBatch(batchId);
  }

  @Get()
  @ApiOperation({ summary: 'List recent ad-hoc reviews' })
  async findRecent() {
    return this.adhocReviewService.findRecent();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single ad-hoc review (poll this for status)' })
  async findOne(@Param('id') id: string) {
    return this.adhocReviewService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a single ad-hoc review' })
  async remove(@Param('id') id: string) {
    return this.adhocReviewService.remove(id);
  }

  @Delete('batch/:batchId')
  @ApiOperation({ summary: 'Delete every review in a zip batch, plus its summary' })
  async removeBatch(@Param('batchId') batchId: string) {
    return this.adhocReviewService.removeBatch(batchId);
  }
}
