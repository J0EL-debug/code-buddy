import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pRetry, { AbortError } from 'p-retry';
import { FileContentWithContext } from '../github/github.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Thrown by callGemini on a non-2xx response. Carries the HTTP status so
 * callers can distinguish "worth retrying" (a transient 5xx/network blip)
 * from "retrying is pointless" (429 quota exhaustion - retrying just wastes
 * time and burns down any recoverable quota faster).
 */
export class GeminiApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'GeminiApiError';
  }

  get isQuotaExceeded(): boolean {
    return this.status === 429;
  }
}

/**
 * LLM Service
 * Integrates directly with Gemini's native REST API for code review
 * analysis. (Google also offers an OpenAI-compatible shim at
 * /v1beta/openai/chat/completions, but it has shown intermittent 404s
 * for some accounts/keys even when the key itself is valid - the native
 * endpoint is more reliable, so we call that directly instead.)
 * Optimized for token efficiency by reviewing only changed lines.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly enabled: boolean;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.modelName = this.configService.get<string>('GEMINI_MODEL_NAME') || 'gemini-2.5-flash';

    if (!apiKey) {
      this.logger.warn('Gemini API not configured - AI review features disabled');
      this.enabled = false;
      return;
    }

    this.enabled = true;
    this.apiKey = apiKey;
    this.logger.log('✓ Gemini client initialized');
  }

  /**
   * Free-tier daily cap Google enforces for this model. Used only to
   * surface a "X/20 used today" indicator in the UI - the real
   * enforcement happens on Google's side (see the 429 handling below).
   */
  static readonly DAILY_QUOTA = 20;

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async recordUsage(): Promise<void> {
    try {
      const date = this.todayKey();
      await this.prisma.geminiUsage.upsert({
        where: { date },
        update: { count: { increment: 1 } },
        create: { date, count: 1 },
      });
    } catch (err) {
      // Usage tracking is best-effort - never let it block an actual review.
      this.logger.warn(`Failed to record Gemini usage: ${err.message}`);
    }
  }

  async getTodayUsage(): Promise<{ used: number; limit: number; date: string }> {
    const date = this.todayKey();
    const row = await this.prisma.geminiUsage.findUnique({ where: { date } });
    return { used: row?.count ?? 0, limit: LlmService.DAILY_QUOTA, date };
  }

  /**
   * Call Gemini's native generateContent REST endpoint.
   * @param systemPrompt System instruction
   * @param userPrompt User message content
   * @returns Response text and token usage
   */
  private async callGemini(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{ content: string; usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }> {
    await this.recordUsage();

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 40000 },
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new GeminiApiError(response.status, `Gemini API error: ${response.status} ${response.statusText} ${errorBody}`);
    }

    const data: any = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';

    return {
      content,
      usage: {
        prompt_tokens: data.usageMetadata?.promptTokenCount,
        completion_tokens: data.usageMetadata?.candidatesTokenCount,
        total_tokens: data.usageMetadata?.totalTokenCount,
      },
    };
  }

  /**
   * Wraps callGemini with retry logic that's aware of WHY a call failed:
   * transient errors (network blips, 5xx) get retried with backoff, but a
   * 429 quota-exceeded error bails out immediately after the first
   * attempt instead of retrying - a daily-quota exhaustion won't resolve
   * itself within the next few seconds, so hammering the API just wastes
   * time (we saw this cost ~10 minutes on a 54-file zip once the free
   * tier's daily cap was hit).
   */
  private async callGeminiWithRetry(systemPrompt: string, userPrompt: string, retries = 3): Promise<string> {
    return pRetry(
      async () => {
        try {
          const res = await this.callGemini(systemPrompt, userPrompt);
          if (!res.content) throw new Error('Empty response from Gemini');
          return res.content;
        } catch (err) {
          if (err instanceof GeminiApiError && err.isQuotaExceeded) {
            throw new AbortError(err);
          }
          throw err;
        }
      },
      {
        retries,
        onFailedAttempt: (err: any) => {
          this.logger.warn(`Retry ${err.attemptNumber}: ${err.message || 'Unknown error'}`);
        },
      },
    );
  }

  /**
   * Check if LLM service is enabled and configured
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Synthesize a project-level brief across every file reviewed in a zip
   * upload - reads like a senior engineer's one-paragraph take after
   * skimming the whole PR, not just a list of per-file summaries stapled
   * together.
   */
  async summarizeProject(
    fileDigests: Array<{ fileName: string; topic: string; summary: string; score: number; issueCount: number }>,
  ): Promise<string> {
    if (!this.enabled) return 'AI summary is not configured (missing GEMINI_API_KEY).';
    if (fileDigests.length === 0) return 'No files were reviewed.';

    const systemPrompt = `You are a senior engineer giving a project-level code review brief after reviewing every file in an uploaded codebase/zip.

You'll be given a per-file digest (name, what it does, its review summary, quality score, issue count). Synthesize these into ONE cohesive paragraph (3-5 sentences) that:
- Identifies the overall health and purpose of the project as a whole (not a per-file recap)
- Calls out any theme/pattern that shows up across multiple files (e.g. "input validation is inconsistent across several endpoints")
- Names the 1-3 files that most need attention, by filename, if any stand out
- Ends with the single most important thing to fix first

Be direct and specific - reference actual filenames and concrete issues, not generic advice. Respond with plain text only, no JSON, no markdown headers.`;

    const digestText = fileDigests
      .map((f) => `- ${f.fileName} (${f.topic}): score ${f.score}/100, ${f.issueCount} issue(s). ${f.summary}`)
      .join('\n');

    const userPrompt = `# Files reviewed (${fileDigests.length} total)\n\n${digestText}\n\nWrite the project-level brief now.`;

    try {
      const response = await this.callGeminiWithRetry(systemPrompt, userPrompt, 2);
      return response.trim();
    } catch (error) {
      this.logger.error(`Failed to generate project summary: ${error.message}`);
      const avgScore = Math.round(fileDigests.reduce((s, f) => s + f.score, 0) / fileDigests.length);
      const totalIssues = fileDigests.reduce((s, f) => s + f.issueCount, 0);
      return `Reviewed ${fileDigests.length} files with an average score of ${avgScore}/100 and ${totalIssues} total issue(s) found.`;
    }
  }

  /**
   * Review a full standalone file (no diff/PR context) - used for the
   * "paste or upload code" flow where there's no GitHub PR involved.
   * @param fileName Name of the file (used for language detection/context)
   * @param code Full file contents
   * @returns Structured code review result
   */
  /**
   * Review a full standalone file (no diff/PR context) - used for the
   * "paste or upload code" flow where there's no GitHub PR involved.
   * @param fileName Name of the file (used for language detection/context)
   * @param code Full file contents
   * @param mode "review" just finds issues; "fix" also rewrites the code
   * @returns Structured code review result
   */
  async reviewFullFile(fileName: string, code: string, mode: 'review' | 'fix' = 'review'): Promise<FullFileReviewResult> {
    if (!this.enabled) {
      this.logger.warn('LLM service disabled - returning empty review');
      return { topic: fileName, summary: 'AI review is not configured (missing GEMINI_API_KEY).', recommendation: '', issues: [] };
    }

    const fixInstructions = mode === 'fix'
      ? `
5. Additionally, rewrite the ENTIRE file with every issue fixed. Preserve the original structure, style, and intent - only change what's needed to fix the flagged issues (don't refactor unrelated code).
6. List each change you made in "changes", in the order they appear in the fixed file.`
      : '';

    const fixSchema = mode === 'fix'
      ? `,
  "fixedCode": "The complete corrected file content, with every flagged issue fixed. Plain text, not a diff.",
  "changes": [
    { "description": "Plain-language explanation of one specific change made and why" }
  ]`
      : '';

    const systemPrompt = `You are an expert code reviewer analyzing a complete file. This file may be standalone, or one of several files from a larger uploaded project - you can't see the other files, so don't assume something is broken just because you can't see where a function/type is defined elsewhere; only flag it if the file itself gives reason to believe it's actually missing (e.g. no plausible import path for it at all). You have full context on THIS file though, so only report things you can actually verify from what's shown here.

Focus areas (in priority order):
1. Security vulnerabilities (SQL injection, XSS, hardcoded secrets, auth flaws, unsafe deserialization)
2. Logic errors and bugs (off-by-one, null/undefined handling, incorrect conditionals, race conditions)
3. Performance issues (N+1 queries, unnecessary re-computation, inefficient algorithms/data structures)
4. Best practice violations that cause real problems (not just taste - e.g. missing error handling, resource leaks)${fixInstructions}
Style/formatting nitpicks are lowest priority - only mention them if nothing more substantive was found.

Quality bar for issues:
- One issue per distinct problem - don't report the same root cause on multiple nearby lines.
- Every issue needs a "suggestion" specific enough that someone could apply it without further research (name the exact function/approach, not "consider improving this").
- Prefer fewer, well-explained issues over an exhaustive list of minor nitpicks. Cap yourself at the ~10 most impactful issues if the file has more problems than that.
- Severity should reflect real-world impact: "critical" = exploitable/data-loss/crash, "high" = likely to cause bugs in production, "medium" = worth fixing soon, "low" = minor/cosmetic.

Response format (valid JSON only):
{
  "topic": "A short 3-6 word description of what this code does, e.g. 'User login form validation' or 'Binary search implementation' - used as a human-friendly title, NOT the filename",
  "summary": "Brief overall assessment in 1-2 sentences",
  "recommendation": "1-3 sentences of concrete, prioritized advice - what to fix first and why, or how to harden/extend this code. Reference specifics (function/variable names, line numbers) rather than generic advice. Skip filler like 'looks good' - give substantive guidance even when the code is solid.",
  "issues": [
    {
      "line": <line_number>,
      "severity": "critical|high|medium|low",
      "type": "security|performance|logic|style",
      "message": "Clear description of the issue - what's wrong and why it matters",
      "suggestion": "Specific, actionable fix - concrete enough to apply directly"
    }
  ]${fixSchema}
}

If no significant issues found, still include "topic" and a substantive "recommendation" (e.g. what to consider as this code evolves), and return an empty "issues" array.`;

    const numberedCode = code
      .split('\n')
      .map((line, idx) => `${(idx + 1).toString().padStart(4, ' ')} ${line}`)
      .join('\n');

    const userPrompt = `# Code Review Task

## File: ${fileName}

\`\`\`
${numberedCode}
\`\`\`

Review the file above and return your findings in the required JSON format, including a short "topic" title and a concrete "recommendation". Line numbers should match the numbers shown to the left of each line.${mode === 'fix' ? ' Also include the complete corrected "fixedCode" and a "changes" list.' : ''}`;

    try {
      const review = await this.callGeminiWithRetry(systemPrompt, userPrompt, 3);

      return this.parseFullFileReviewResponse(review, fileName);
    } catch (error) {
      this.logger.error(`Failed to get full-file LLM review: ${error.message}`);
      if (error instanceof GeminiApiError && error.isQuotaExceeded) {
        throw new Error(
          'Gemini free-tier daily quota exceeded (the free tier allows a limited number of requests per day). ' +
          'Try again later, or reduce how many files you review at once.',
        );
      }
      return { topic: fileName, summary: 'Error during review - please try again', recommendation: '', issues: [] };
    }
  }

  /**
   * Parse a full-file review response (includes the "topic" title and
   * "recommendation" fields that diff-based reviews don't have, plus
   * optional "fixedCode"/"changes" when reviewed in fix mode).
   */
  private parseFullFileReviewResponse(response: string, fallbackFileName: string): FullFileReviewResult {
    try {
      const cleanResponse = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleanResponse);

      if (!parsed.summary || !Array.isArray(parsed.issues)) {
        throw new Error('Invalid response structure');
      }

      return {
        topic: (parsed.topic && String(parsed.topic).trim()) || fallbackFileName,
        summary: parsed.summary,
        recommendation: (parsed.recommendation && String(parsed.recommendation).trim()) || '',
        fixedCode: typeof parsed.fixedCode === 'string' ? parsed.fixedCode : undefined,
        changes: Array.isArray(parsed.changes)
          ? parsed.changes.map((c: any) => ({ description: c.description || String(c) }))
          : undefined,
        issues: parsed.issues.map((issue: any) => ({
          line: parseInt(issue.line) || 0,
          severity: issue.severity || 'low',
          type: issue.type || 'style',
          message: issue.message || 'No description',
          suggestion: issue.suggestion || 'No suggestion',
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to parse full-file LLM response: ${error.message}`);
      this.logger.debug(`Raw response: ${response}`);
      return {
        topic: fallbackFileName,
        summary: 'Failed to parse review results',
        recommendation: '',
        issues: [],
      };
    }
  }

  /**
   * Review multiple chunks in a single LLM call (batching for efficiency)
   * @param chunks Array of diff chunks to review together
   * @returns Structured code review result with issues from all files
   */
  async reviewMultipleChunks(chunks: DiffChunk[], styleGuide?: string): Promise<BatchedCodeReviewResult> {
    if (!this.enabled) {
      this.logger.warn('LLM service disabled - returning empty review');
      return { summary: '', issues: [] };
    }

    const systemPrompt = this.getSystemPrompt(styleGuide);
    const userPrompt = this.buildBatchedPrompt(chunks);

    this.logger.log('='.repeat(80));
    this.logger.log(`📤 SENDING BATCHED PROMPT (${chunks.length} files)`);
    this.logger.log('='.repeat(80));
    console.log('\n🔷 SYSTEM PROMPT:');
    console.log(systemPrompt);
    console.log('\n🔷 USER PROMPT (Batched):');
    console.log(userPrompt);
    console.log('\n' + '='.repeat(80) + '\n');

    try {
      const review = await pRetry(
        async () => {
          let response;
          try {
            response = await this.callGemini(systemPrompt, userPrompt);
          } catch (err) {
            if (err instanceof GeminiApiError && err.isQuotaExceeded) {
              throw new AbortError(err);
            }
            throw err;
          }

          const content = response.content;
          if (!content) {
            throw new Error('Empty response from Gemini');
          }

          this.logger.log('='.repeat(80));
          this.logger.log('📥 RECEIVED BATCHED RESPONSE');
          this.logger.log('='.repeat(80));
          console.log('\n🔶 RAW RESPONSE:');
          console.log(content);
          console.log('\n🔶 TOKEN USAGE:');
          console.log(JSON.stringify(response.usage, null, 2));
          console.log('\n' + '='.repeat(80) + '\n');

          return content;
        },
        {
          retries: 3,
          onFailedAttempt: (err: any) => {
            this.logger.warn(`Retry ${err.attemptNumber}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          },
        },
      );

      const parsed = this.parseBatchedReviewResponse(review);
      this.logger.log(`✅ Parsed batched review: ${parsed.issues.length} total issues`);

      return parsed;
    } catch (error) {
      this.logger.error(`Failed to get batched LLM review: ${error.message}`);
      return { summary: 'Error during batched review', issues: [] };
    }
  }

  /**
   * Review code changes using Gemini
   * @param chunk Diff chunk with changed lines and context
   * @returns Structured code review result
   */
  async reviewChangedLines(chunk: DiffChunk, styleGuide?: string): Promise<CodeReviewResult> {
    if (!this.enabled) {
      this.logger.warn('LLM service disabled - returning empty review');
      return { summary: '', issues: [] };
    }

    const systemPrompt = this.getSystemPrompt(styleGuide);
    const userPrompt = this.buildOptimizedPrompt(chunk);

    // Log prompt being sent to LLM
    this.logger.log('='.repeat(80));
    this.logger.log('📤 SENDING PROMPT TO LLM');
    this.logger.log('='.repeat(80));
    console.log('\n🔷 SYSTEM PROMPT:');
    console.log(systemPrompt);
    console.log('\n🔷 USER PROMPT:');
    console.log(userPrompt);
    console.log('\n' + '='.repeat(80) + '\n');

    try {
      const review = await pRetry(
        async () => {
          let response;
          try {
            response = await this.callGemini(systemPrompt, userPrompt);
          } catch (err) {
            if (err instanceof GeminiApiError && err.isQuotaExceeded) {
              throw new AbortError(err);
            }
            throw err;
          }

          const content = response.content;
          if (!content) {
            throw new Error('Empty response from Gemini');
          }

          // Log LLM response
          this.logger.log('='.repeat(80));
          this.logger.log('📥 RECEIVED RESPONSE FROM LLM');
          this.logger.log('='.repeat(80));
          console.log('\n🔶 RAW RESPONSE:');
          console.log(content);
          console.log('\n🔶 TOKEN USAGE:');
          console.log(JSON.stringify(response.usage, null, 2));
          console.log('\n' + '='.repeat(80) + '\n');

          return content;
        },
        {
          retries: 3,
          onFailedAttempt: (err: any) => {
            this.logger.warn(`Retry ${err.attemptNumber}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          },
        },
      );

      const parsed = this.parseReviewResponse(review);

      // Log parsed result
      this.logger.log('✅ Parsed review result:');
      console.log(JSON.stringify(parsed, null, 2));

      return parsed;
    } catch (error) {
      this.logger.error(`Failed to get LLM review: ${error.message}`);
      return { summary: 'Error during review', issues: [] };
    }
  }

  /**
   * Build batched prompt combining multiple file changes
   * @param chunks Array of chunks to review
   * @returns Combined prompt
   */
  private buildBatchedPrompt(chunks: DiffChunk[]): string {
    let prompt = `# Batched Code Review Task

Reviewing ${chunks.length} file(s) with changes.

`;

    // Add each file as a section
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      prompt += `---\n\n## File ${i + 1}/${chunks.length}: ${chunk.filename}\n\n`;
      prompt += `**Language:** ${chunk.language}\n`;
      prompt += `**Changes:** +${chunk.additions} -${chunk.deletions}\n\n`;

      // Imports
      if (chunk.fileContext?.imports && chunk.fileContext.imports.length > 0) {
        prompt += `### ✅ Available Imports\n\n`;
        prompt += `\`\`\`${chunk.language}\n${chunk.fileContext.imports.join('\n')}\n\`\`\`\n\n`;
      }

      // Context
      if (chunk.fileContext && chunk.fileContext.lines.length > 0) {
        prompt += `### Code Context\n\n`;
        prompt += `\`\`\`${chunk.language}\n`;
        prompt += chunk.fileContext.lines.map((line, idx) => {
          const lineNum = chunk.fileContext!.startLineNumber + idx;
          const isTargetLine = lineNum === chunk.fileContext!.targetLineNumber;
          return `${lineNum.toString().padStart(4, ' ')} ${isTargetLine ? '→' : ' '} ${line}`;
        }).join('\n');
        prompt += `\n\`\`\`\n\n`;
      }

      // Diff
      prompt += `### Changes to Review\n\n`;
      prompt += `\`\`\`diff\n${chunk.hunks}\n\`\`\`\n\n`;
    }

    prompt += `---\n\n## Instructions\n\n`;
    prompt += `1. Review ALL ${chunks.length} files listed above\n`;
    prompt += `2. For EACH file, check the Available Imports before reporting missing imports\n`;
    prompt += `3. Provide line numbers and file names in your response\n`;
    prompt += `4. Focus on security, logic, and performance issues\n`;
    prompt += `5. Return a single JSON with all issues from all files\n\n`;
    prompt += `**Response format:**\n`;
    prompt += `\`\`\`json\n{\n`;
    prompt += `  "summary": "Overall assessment of all ${chunks.length} files",\n`;
    prompt += `  "issues": [\n`;
    prompt += `    {\n`;
    prompt += `      "file": "path/to/file.ts",\n`;
    prompt += `      "line": <line_number>,\n`;
    prompt += `      "severity": "critical|high|medium|low",\n`;
    prompt += `      "type": "security|performance|logic|style",\n`;
    prompt += `      "message": "Issue description",\n`;
    prompt += `      "suggestion": "Fix recommendation"\n`;
    prompt += `    }\n`;
    prompt += `  ]\n`;
    prompt += `}\n\`\`\`\n`;

    return prompt;
  }

  /**
   * Get system prompt for code review
   * Emphasizes reviewing only changed lines for token efficiency
   */
  private getSystemPrompt(styleGuide?: string): string {
    const styleGuideBlock = styleGuide?.trim()
      ? `\n\n⚠️ PROJECT-SPECIFIC CONVENTIONS (enforce these in addition to everything below):\n${styleGuide.trim()}\n`
      : '';

    return `You are an expert code reviewer analyzing ONLY CHANGED lines in diffs.
${styleGuideBlock}
CRITICAL RULES:
1. Review ONLY lines starting with + (added) or - (removed)
2. Context lines (no prefix) are for understanding only - DO NOT review them
3. **BEFORE reporting "missing import", CHECK the "Available Imports" section**
4. **BEFORE reporting "undefined variable", CHECK the "Code Context" section**
5. Focus on actual bugs, security issues, and performance problems

⚠️ IMPORT VERIFICATION RULE (MOST IMPORTANT):
- The prompt includes an "Available Imports" section showing ALL imports from the file
- If an import appears in that section, it IS available in the file
- DO NOT report "missing import" if it exists in the imports section
- Only report import issues if the import is truly absent from the list

⚠️ VARIABLE VERIFICATION RULE:
- The prompt includes "Code Context" showing ±10 lines around changes
- Check if variables are defined in the context before reporting undefined
- Only report undefined if truly not present in context or imports

Focus areas (in priority order):
1. Security vulnerabilities (SQL injection, XSS, authentication flaws)
2. Logic errors and bugs
3. Performance issues (N+1 queries, inefficient algorithms)
4. Best practice violations that cause problems
5. Style issues (lowest priority)

Response format (valid JSON only):
{
  "summary": "Brief overall assessment in 1-2 sentences",
  "issues": [
    {
      "line": <line_number_in_new_file>,
      "severity": "critical|high|medium|low",
      "type": "security|performance|logic|style",
      "message": "Clear description of the issue",
      "suggestion": "Specific fix recommendation"
    }
  ]
}

If no significant issues found, return: {"summary": "No major issues found", "issues": []}`;
  }

  /**
   * Build optimized prompt with diff chunk and file context
   * @param chunk Processed diff chunk
   * @returns Formatted prompt for LLM
   */
  private buildOptimizedPrompt(chunk: DiffChunk): string {
    let prompt = `# Code Review Task

## File Information
- **Path:** ${chunk.filename}
- **Language:** ${chunk.language}
- **Changes:** +${chunk.additions} -${chunk.deletions}

`;

    // Add imports if available (shows decorators, types, dependencies)
    if (chunk.fileContext?.imports && chunk.fileContext.imports.length > 0) {
      prompt += `## ✅ Available Imports (VERIFIED - These imports ARE present in the file)

**⚠️ CRITICAL: BEFORE reporting any "missing import" issue, verify the import is NOT in this list!**

\`\`\`${chunk.language}
${chunk.fileContext.imports.join('\n')}
\`\`\`

**Total imports detected:** ${chunk.fileContext.imports.length}
**Rule:** If an import exists above, DO NOT report it as missing.

`;
    } else {
      prompt += `## ⚠️ No Imports Detected

This file has no imports at the top. Any external dependencies WILL be missing.

`;
    }

    // Add actual file content with context if available
    if (chunk.fileContext && chunk.fileContext.lines.length > 0) {
      prompt += `## Code Context (±10 lines around changes)

\`\`\`${chunk.language}
${chunk.fileContext.lines.map((line, idx) => {
  const lineNum = chunk.fileContext!.startLineNumber + idx;
  const isTargetLine = lineNum === chunk.fileContext!.targetLineNumber;
  return `${lineNum.toString().padStart(4, ' ')} ${isTargetLine ? '→' : ' '} ${line}`;
}).join('\n')}
\`\`\`

`;
    }

    prompt += `## Changes to Review (diff format)

**Review ONLY the lines with + (added) or - (removed) prefix:**

\`\`\`diff
${chunk.hunks}
\`\`\`

---

## Review Instructions

1. **Available Imports section** shows ALL imports - these ARE in the file
2. **Code Context section** shows ±10 lines around changes for understanding
3. **Review ONLY** lines with plus or minus prefix in the diff
4. **DO NOT** report missing imports that are in the Available Imports section
5. **DO NOT** report undefined variables that are in the Code Context section
6. Provide line numbers relative to the NEW file (after changes)
7. Focus on security, logic errors, and performance - not minor style issues

**Remember:** Imports and context are DEFINITIVE - if they are shown, they exist!`;

    return prompt;
  }

  /**
   * Parse LLM response into structured format
   * @param response Raw LLM response string
   * @returns Structured code review result
   */
  private parseReviewResponse(response: string): CodeReviewResult {
    try {
      // Remove markdown code blocks if present
      const cleanResponse = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleanResponse);

      // Validate structure
      if (!parsed.summary || !Array.isArray(parsed.issues)) {
        throw new Error('Invalid response structure');
      }

      return {
        summary: parsed.summary,
        issues: parsed.issues.map((issue: any) => ({
          line: parseInt(issue.line) || 0,
          severity: issue.severity || 'low',
          type: issue.type || 'style',
          message: issue.message || 'No description',
          suggestion: issue.suggestion || 'No suggestion',
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to parse LLM response: ${error.message}`);
      this.logger.debug(`Raw response: ${response}`);
      return {
        summary: 'Failed to parse review results',
        issues: [],
      };
    }
  }

  /**
   * Parse batched LLM response with issues from multiple files
   * @param response Raw LLM response string
   * @returns Batched review result
   */
  private parseBatchedReviewResponse(response: string): BatchedCodeReviewResult {
    try {
      const cleanResponse = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleanResponse);

      if (!parsed.summary || !Array.isArray(parsed.issues)) {
        throw new Error('Invalid batched response structure');
      }

      return {
        summary: parsed.summary,
        issues: parsed.issues.map((issue: any) => ({
          file: issue.file || 'unknown',
          line: parseInt(issue.line) || 0,
          severity: issue.severity || 'low',
          type: issue.type || 'style',
          message: issue.message || 'No description',
          suggestion: issue.suggestion || 'No suggestion',
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to parse batched LLM response: ${error.message}`);
      this.logger.debug(`Raw response: ${response}`);
      return {
        summary: 'Failed to parse batched review results',
        issues: [],
      };
    }
  }
}

/**
 * Diff chunk for LLM review
 */
export interface DiffChunk {
  filename: string;
  language: string;
  hunks: string; // Formatted diff with context
  additions: number;
  deletions: number;
  fileContext?: FileContentWithContext;
}

/**
 * Structured code review result from LLM
 */
export interface CodeReviewResult {
  summary: string;
  issues: Array<{
    line: number;
    severity: 'critical' | 'high' | 'medium' | 'low';
    type: 'security' | 'performance' | 'logic' | 'style';
    message: string;
    suggestion: string;
  }>;
}

/**
 * Full-file (non-diff) review result, used by the ad-hoc paste/upload flow.
 * Adds a "topic" - a short AI-generated description of what the code does,
 * used in place of the raw filename in the UI.
 */
export interface FullFileReviewResult extends CodeReviewResult {
  topic: string;
  recommendation: string;
  fixedCode?: string;
  changes?: Array<{ description: string }>;
}

/**
 * Batched code review result with issues from multiple files
 */
export interface BatchedCodeReviewResult {
  summary: string;
  issues: Array<{
    file: string;
    line: number;
    severity: 'critical' | 'high' | 'medium' | 'low';
    type: 'security' | 'performance' | 'logic' | 'style';
    message: string;
    suggestion: string;
  }>;
}