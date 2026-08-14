import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import PQueue from 'p-queue';
// adm-zip is a CommonJS module (module.exports = AdmZip) - importing it as
// a default ES export can resolve to { default: AdmZip } instead of the
// class itself depending on TS/bundler interop settings, causing
// "AdmZip is not a constructor". require() sidesteps that entirely.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const AdmZip = require('adm-zip');
type AdmZipInstance = any;
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

const MAX_CODE_SIZE = 200_000; // ~200KB per file - keeps latency/cost reasonable for a live demo
const MAX_ZIP_FILES = 60; // cap how many files from one zip we'll review
const MAX_ZIP_TOTAL_SIZE = 1_800_000; // ~1.8MB combined across all reviewed files in a zip

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  mjs: 'JavaScript', cjs: 'JavaScript', vue: 'Vue', svelte: 'Svelte',
  py: 'Python', java: 'Java', go: 'Go', rs: 'Rust', rb: 'Ruby',
  php: 'PHP', cs: 'C#', cpp: 'C++', cc: 'C++', c: 'C', h: 'C/C++ Header', hpp: 'C++ Header',
  kt: 'Kotlin', swift: 'Swift', scala: 'Scala', dart: 'Dart', m: 'Objective-C', mm: 'Objective-C++',
  sql: 'SQL', sh: 'Shell', bash: 'Shell', ps1: 'PowerShell',
  html: 'HTML', css: 'CSS', scss: 'SCSS', less: 'LESS',
  json: 'JSON', yaml: 'YAML', yml: 'YAML',
};

// Only these are worth reviewing - skips images, binaries, lockfiles, etc.
const REVIEWABLE_EXTENSIONS = new Set(Object.keys(EXTENSION_LANGUAGE_MAP));

// Never descend into these directories inside an uploaded zip
const IGNORED_PATH_SEGMENTS = ['node_modules/', '.git/', 'dist/', 'build/', '.venv/', '__pycache__/', 'vendor/'];

/**
 * Ad-hoc Review Service
 * Reviews are processed asynchronously via an in-memory queue (same
 * architectural pattern as the GitHub webhook pipeline's ReviewProcessor) -
 * a row is created immediately with status PENDING, and updated in place
 * as the review runs, so the frontend can poll for completion.
 */
@Injectable()
export class AdhocReviewService {
  private readonly logger = new Logger(AdhocReviewService.name);
  private readonly queue = new PQueue({ concurrency: 2 });

  // Circuit breaker: once Gemini reports the free-tier daily quota is
  // exhausted, further calls within this window are guaranteed to fail
  // too - so we skip calling the API at all and fail those rows instantly,
  // instead of each one waiting on a doomed request (this is what made a
  // 54-file zip take ~10 minutes after the quota was already blown).
  private quotaExceededUntil: number | null = null;
  private static readonly QUOTA_COOLDOWN_MS = 60_000;

  constructor(
    private prisma: PrismaService,
    private llmService: LlmService,
  ) {}

  private detectLanguage(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return EXTENSION_LANGUAGE_MAP[ext] || 'Plain text';
  }

  /**
   * Sniffs the first few bytes of a file to identify its real archive
   * format, regardless of what its extension claims. Catches the most
   * common mistake with 7-Zip/WinRAR: picking "7z" or "rar" as the
   * archive format while the saved filename still ends in ".zip".
   * Returns null if the bytes don't match any recognized archive format.
   */
  private detectArchiveFormat(buffer: Buffer): 'zip' | '7z' | 'rar' | 'gzip' | 'tar' | null {
    if (buffer.length < 6) return null;

    const b = buffer;
    // ZIP: "PK\x03\x04" (normal), "PK\x05\x06" (empty archive), "PK\x07\x08" (spanned)
    if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) {
      return 'zip';
    }
    // 7z: "7z\xBC\xAF\x27\x1C"
    if (b[0] === 0x37 && b[1] === 0x7a && b[2] === 0xbc && b[3] === 0xaf && b[4] === 0x27 && b[5] === 0x1c) {
      return '7z';
    }
    // RAR: "Rar!\x1A\x07"
    if (b[0] === 0x52 && b[1] === 0x61 && b[2] === 0x72 && b[3] === 0x21 && b[4] === 0x1a && b[5] === 0x07) {
      return 'rar';
    }
    // gzip (e.g. a .tar.gz uploaded with a .zip name)
    if (b[0] === 0x1f && b[1] === 0x8b) {
      return 'gzip';
    }
    // Uncompressed tar has "ustar" at offset 257 - only check if buffer is long enough
    if (buffer.length > 262 && buffer.toString('ascii', 257, 262) === 'ustar') {
      return 'tar';
    }

    return null;
  }

  /**
   * Submit a single pasted or uploaded file for review. Returns
   * immediately with a PENDING row; processing happens in the background.
   */
  async review(fileName: string, code: string, mode: 'review' | 'fix' = 'review', batchId?: string) {
    if (!code || !code.trim()) {
      throw new BadRequestException('No code provided');
    }
    if (code.length > MAX_CODE_SIZE) {
      throw new BadRequestException(`Code exceeds the ${MAX_CODE_SIZE.toLocaleString()} character limit for a single review`);
    }

    const safeFileName = fileName?.trim() || 'untitled.txt';
    const language = this.detectLanguage(safeFileName);

    const row = await this.prisma.adhocReview.create({
      data: {
        fileName: safeFileName,
        language,
        code,
        mode,
        status: 'PENDING',
        batchId,
      },
    });

    this.queue
      .add(() => this.process(row.id, safeFileName, code, mode, batchId))
      .catch((err) => this.logger.error(`Queued ad-hoc review ${row.id} failed: ${err?.message ?? err}`));

    return row;
  }

  /**
   * Extract a zip upload, review every recognizable code file inside it
   * (bounded by MAX_ZIP_FILES / MAX_ZIP_TOTAL_SIZE), and return the set of
   * PENDING rows sharing a batchId.
   */
  async reviewZip(originalName: string, buffer: Buffer, mode: 'review' | 'fix' = 'review') {
    this.logger.log(`Attempting to read zip "${originalName}" (${buffer.length.toLocaleString()} bytes)`);

    const detectedFormat = this.detectArchiveFormat(buffer);
    if (detectedFormat && detectedFormat !== 'zip') {
      this.logger.error(`Rejected "${originalName}": detected as ${detectedFormat}, not a real zip`);
      throw new BadRequestException(
        `This file is actually a ${detectedFormat.toUpperCase()} archive, not a zip - even though it may be named ` +
        `".zip". If you used 7-Zip or WinRAR, check the "Archive format" dropdown is set to "zip" (not "7z" or "rar") ` +
        `when creating it, or use Windows' built-in "Compress to ZIP file" instead.`,
      );
    }
    if (detectedFormat === null) {
      this.logger.error(`Rejected "${originalName}": does not look like any recognized archive format`);
      throw new BadRequestException(
        'This file doesn\'t look like a valid zip archive at all. Please double check the file and try again.',
      );
    }

    let zip: AdmZipInstance;
    try {
      zip = new AdmZip(buffer);
      // Force entry parsing now (AdmZip's constructor can succeed even on
      // a malformed archive - getEntries() is what actually throws).
      zip.getEntries();
    } catch (err: any) {
      this.logger.error(`Failed to read zip "${originalName}": ${err?.message || err}`);
      throw new BadRequestException(
        'Could not read this zip file. It may be password-protected, use an unsupported compression method, ' +
        'or be corrupted. Try re-creating it with a standard zip tool (e.g. right-click a folder -> "Compress to ZIP file" on Windows) and upload again.',
      );
    }

    const encryptedEntries = zip.getEntries().filter((e) => (e as any).header?.encripted || (e as any).header?.encrypted);
    if (encryptedEntries.length > 0) {
      throw new BadRequestException(
        'This zip is password-protected/encrypted. Please remove the password and upload an unencrypted zip.',
      );
    }

    const entries = zip.getEntries().filter((entry) => {
      if (entry.isDirectory) return false;
      const path = entry.entryName.replace(/\\/g, '/');
      if (IGNORED_PATH_SEGMENTS.some((seg) => path.includes(seg))) return false;
      const ext = path.split('.').pop()?.toLowerCase() || '';
      return REVIEWABLE_EXTENSIONS.has(ext);
    });

    if (entries.length === 0) {
      throw new BadRequestException('No reviewable source files found in this zip');
    }

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const rows = [];
    let totalSize = 0;

    for (const entry of entries.slice(0, MAX_ZIP_FILES)) {
      const code = entry.getData().toString('utf-8');
      if (!code.trim()) continue;
      if (totalSize + code.length > MAX_ZIP_TOTAL_SIZE) {
        this.logger.warn(`Zip batch ${batchId} hit the combined size cap - stopping early`);
        break;
      }
      totalSize += code.length;

      const row = await this.review(entry.entryName, code, mode, batchId);
      rows.push(row);
    }

    if (rows.length === 0) {
      throw new BadRequestException('Files in this zip were empty or too large to review');
    }

    await this.prisma.adhocBatchSummary.create({
      data: {
        batchId,
        name: originalName.replace(/\.zip$/i, ''),
        status: 'PENDING',
        fileCount: rows.length,
      },
    });

    this.logger.log(`Zip "${originalName}" -> batch ${batchId}: reviewing ${rows.length} file(s)`);

    return { batchId, reviews: rows };
  }

  /**
   * Background job: run the LLM review and update the row with the result.
   */
  private async process(id: string, fileName: string, code: string, mode: 'review' | 'fix', batchId?: string) {
    // Circuit breaker: skip the API call entirely if we already know quota
    // is exhausted right now.
    if (this.quotaExceededUntil && Date.now() < this.quotaExceededUntil) {
      this.logger.warn(`Skipping ${fileName} - Gemini quota was exhausted moments ago, not retrying yet`);
      await this.prisma.adhocReview.update({
        where: { id },
        data: {
          status: 'FAILED',
          errorMessage: 'Skipped - Gemini free-tier daily quota was exhausted earlier in this batch. Try again later.',
        },
      });
      if (batchId) await this.maybeFinalizeBatch(batchId);
      return;
    }

    await this.prisma.adhocReview.update({ where: { id }, data: { status: 'PROCESSING' } });

    try {
      const result = await this.llmService.reviewFullFile(fileName, code, mode);

      const score = Math.max(
        0,
        100 - result.issues.reduce((total, issue) => {
          const weight = { critical: 30, high: 15, medium: 7, low: 2 }[issue.severity] ?? 2;
          return total + weight;
        }, 0),
      );

      await this.prisma.adhocReview.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          topic: result.topic,
          summary: result.summary,
          recommendation: result.recommendation,
          issues: result.issues as any,
          fixedCode: result.fixedCode,
          changes: result.changes as any,
          score,
        },
      });
    } catch (error) {
      this.logger.error(`Ad-hoc review ${id} failed: ${error.message}`);
      if (/quota/i.test(error.message || '')) {
        this.quotaExceededUntil = Date.now() + AdhocReviewService.QUOTA_COOLDOWN_MS;
      }
      await this.prisma.adhocReview.update({
        where: { id },
        data: { status: 'FAILED', errorMessage: error.message?.slice(0, 500) || 'Unknown error' },
      });
    }

    if (batchId) {
      await this.maybeFinalizeBatch(batchId);
    }
  }

  /**
   * Once every file in a zip batch has finished (COMPLETED or FAILED),
   * compute the overall project score and generate an AI project-level
   * brief. Safe to call multiple times - only runs once per batch thanks
   * to the PENDING -> guard check.
   */
  private async maybeFinalizeBatch(batchId: string) {
    const summaryRow = await this.prisma.adhocBatchSummary.findUnique({ where: { batchId } });
    if (!summaryRow || summaryRow.status !== 'PENDING') return;

    const members = await this.prisma.adhocReview.findMany({ where: { batchId } });
    const allDone = members.every((m) => m.status === 'COMPLETED' || m.status === 'FAILED');
    if (!allDone) return;

    // Claim it immediately so concurrent completions from other files in
    // the same batch don't both try to finalize it.
    const claimed = await this.prisma.adhocBatchSummary.updateMany({
      where: { batchId, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });
    if (claimed.count === 0) return;

    try {
      const completed = members.filter((m) => m.status === 'COMPLETED');
      const overallScore = completed.length > 0
        ? Math.round(completed.reduce((sum, m) => sum + (m.score ?? 0), 0) / completed.length)
        : 0;

      const digests = completed.map((m) => ({
        fileName: m.fileName,
        topic: m.topic || m.fileName,
        summary: m.summary || '',
        score: m.score ?? 0,
        issueCount: Array.isArray(m.issues) ? (m.issues as any[]).length : 0,
      }));

      const overallBrief = await this.llmService.summarizeProject(digests);

      await this.prisma.adhocBatchSummary.update({
        where: { batchId },
        data: { status: 'COMPLETED', overallScore, overallBrief },
      });
    } catch (error) {
      this.logger.error(`Failed to finalize batch ${batchId}: ${error.message}`);
      await this.prisma.adhocBatchSummary.update({
        where: { batchId },
        data: { status: 'FAILED' },
      });
    }
  }

  /**
   * One row per reviewed "project" - each zip upload is a project (named
   * after the zip file); each standalone paste/single-file review is its
   * own project too, named by topic. Used to give the Dashboard a clean
   * per-project breakdown instead of one blended number, once there's more
   * than one thing that's been reviewed.
   */
  async findProjects(limit = 20) {
    const batches = await this.prisma.adhocBatchSummary.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const standalone = await this.prisma.adhocReview.findMany({
      where: { batchId: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        topic: true,
        fileName: true,
        score: true,
        status: true,
        createdAt: true,
      },
    });

    const batchProjects = batches.map((b) => ({
      key: b.batchId,
      type: 'zip' as const,
      name: b.name,
      score: b.overallScore,
      fileCount: b.fileCount,
      status: b.status,
      createdAt: b.createdAt,
    }));

    const standaloneProjects = standalone.map((r) => ({
      key: r.id,
      type: 'single' as const,
      name: r.topic || r.fileName,
      score: r.score,
      fileCount: 1,
      status: r.status,
      createdAt: r.createdAt,
    }));

    return [...batchProjects, ...standaloneProjects]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async findRecent(limit = 20) {
    return this.prisma.adhocReview.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        batchId: true,
        fileName: true,
        language: true,
        mode: true,
        status: true,
        topic: true,
        summary: true,
        recommendation: true,
        issues: true,
        fixedCode: true,
        changes: true,
        score: true,
        errorMessage: true,
        createdAt: true,
      },
    });
  }

  async findOne(id: string) {
    const review = await this.prisma.adhocReview.findUnique({ where: { id } });
    if (!review) {
      throw new NotFoundException('Review not found');
    }
    return review;
  }

  async findBatch(batchId: string) {
    const reviews = await this.prisma.adhocReview.findMany({
      where: { batchId },
      orderBy: { createdAt: 'asc' },
    });
    if (reviews.length === 0) {
      throw new NotFoundException('Batch not found');
    }
    const summary = await this.prisma.adhocBatchSummary.findUnique({ where: { batchId } });
    return { batchId, reviews, summary };
  }

  async remove(id: string) {
    await this.findOne(id); // 404s if it doesn't exist
    await this.prisma.adhocReview.delete({ where: { id } });
    return { success: true };
  }

  async removeBatch(batchId: string) {
    const existing = await this.prisma.adhocReview.findFirst({ where: { batchId } });
    if (!existing) {
      throw new NotFoundException('Batch not found');
    }
    await this.prisma.adhocReview.deleteMany({ where: { batchId } });
    await this.prisma.adhocBatchSummary.deleteMany({ where: { batchId } });
    return { success: true };
  }
}
