import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

/**
 * GitHub Service
 * Handles interaction with the GitHub API for posting review comments and
 * fetching pull request diffs/file content.
 */
@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private readonly client: Octokit;

  constructor(private configService: ConfigService) {
    const token = this.configService.get<string>('GITHUB_ACCESS_TOKEN');

    if (!token) {
      this.logger.warn('GITHUB_ACCESS_TOKEN not configured - GitHub features disabled');
    }

    this.client = new Octokit({
      auth: token || undefined,
    });
  }

  /**
   * Post a general (summary) comment on a pull request
   * @param owner Repository owner (user or org login)
   * @param repo Repository name
   * @param prNumber Pull request number
   * @param comment Comment text (supports Markdown)
   */
  async postPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    comment: string,
  ): Promise<void> {
    try {
      // PR comments (not tied to a specific line) use the Issues API in GitHub,
      // since every PR is also an issue under the hood.
      await this.client.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: comment,
      });
      this.logger.log(`✓ Posted summary comment to PR #${prNumber}`);
    } catch (error) {
      this.logger.error(`Failed to post PR comment: ${error.message}`);
      throw error;
    }
  }

  /**
   * Submit a formal PR review (not just a comment) - this is what makes a
   * merge gate actually work: a REQUEST_CHANGES review shows in GitHub's
   * "Reviewers" panel and, combined with a branch protection rule requiring
   * approval, can genuinely block a PR from merging. APPROVE/COMMENT work
   * the same way for the non-blocking cases.
   */
  async submitPRReview(
    owner: string,
    repo: string,
    prNumber: number,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    body: string,
  ): Promise<void> {
    try {
      await this.client.rest.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        body,
        event,
      });
      this.logger.log(`✓ Submitted formal review (${event}) on PR #${prNumber}`);
    } catch (error) {
      this.logger.error(`Failed to submit PR review: ${error.message}`);
      // Fall back to a plain comment so the review isn't silently lost if,
      // say, the token lacks permission to formally review its own PR.
      await this.postPRComment(owner, repo, prNumber, body).catch(() => {});
    }
  }

  /**
   * Post an inline review comment at a specific line in the diff
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber Pull request number
   * @param diffData Inline comment data with position
   */
  async postInlineComment(
    owner: string,
    repo: string,
    prNumber: number,
    diffData: InlineCommentData,
  ): Promise<void> {
    try {
      this.logger.log(`📝 Attempting to post inline comment:`);
      this.logger.log(`   File: ${diffData.filePath}`);
      this.logger.log(`   Line: ${diffData.line}`);
      this.logger.log(`   headSha: ${diffData.headSha.substring(0, 8)}`);

      await this.client.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number: prNumber,
        body: diffData.comment,
        commit_id: diffData.headSha,
        path: diffData.filePath,
        line: diffData.line,
        side: 'RIGHT',
      });
      this.logger.log(`✓ Posted inline comment at ${diffData.filePath}:${diffData.line}`);
    } catch (error) {
      this.logger.error(`❌ Failed to post inline comment at ${diffData.filePath}:${diffData.line}`);
      this.logger.error(`   Error: ${error.message}`);
      // Don't throw - inline comments are non-critical. A common cause of
      // failure here is that `line` isn't part of the diff's addressable
      // range (e.g. an unchanged context line), which GitHub rejects.
    }
  }

  /**
   * Get the file-level diffs for a pull request
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber Pull request number
   * @returns Array of diff objects, normalized to look like the old GitLab shape
   */
  async getPRDiffs(owner: string, repo: string, prNumber: number) {
    try {
      this.logger.log(`Fetching diffs for PR #${prNumber} in ${owner}/${repo}...`);

      const files = await this.client.paginate(this.client.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100,
      });

      // Normalize to the {new_path, old_path, diff} shape the rest of the
      // pipeline expects (this used to be GitLab's diff object shape).
      const diffs = files.map((file) => ({
        new_path: file.filename,
        old_path: file.previous_filename || file.filename,
        diff: file.patch || '',
      }));

      this.logger.log(`✓ Fetched ${diffs.length} file diffs for PR #${prNumber}`);

      if (diffs.length === 0) {
        this.logger.warn(`No diffs found for PR #${prNumber}.`);
      }

      return diffs;
    } catch (error) {
      this.logger.error(`Failed to fetch PR diffs for ${owner}/${repo}#${prNumber}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get pull request details including base/head SHAs
   * @param owner Repository owner
   * @param repo Repository name
   * @param prNumber Pull request number
   * @returns PR details with SHA values
   */
  async getPRDetails(owner: string, repo: string, prNumber: number) {
    try {
      this.logger.log(`Fetching PR details for #${prNumber} in ${owner}/${repo}...`);

      const { data: pr } = await this.client.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      const details = {
        baseSha: pr.base?.sha || '',
        headSha: pr.head?.sha || '',
        // GitHub has no direct equivalent of GitLab's "start_sha" (used there
        // to track rebases mid-review) - the base SHA serves the same role.
        startSha: pr.base?.sha || '',
        sourceBranch: pr.head?.ref || '',
        targetBranch: pr.base?.ref || '',
      };

      this.logger.log(`✓ Fetched PR details: baseSha=${details.baseSha.substring(0, 8)}, headSha=${details.headSha.substring(0, 8)}`);
      this.logger.log(`   Source: ${details.sourceBranch} → Target: ${details.targetBranch}`);

      return details;
    } catch (error) {
      this.logger.error(`Failed to fetch PR details for ${owner}/${repo}#${prNumber}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get file content at a specific commit SHA with surrounding lines
   * @param owner Repository owner
   * @param repo Repository name
   * @param filePath File path in repository
   * @param sha Commit SHA
   * @param lineNumber Target line number
   * @param contextLines Number of lines before/after (default: 10)
   * @returns File content with context lines
   */
  async getFileContentWithContext(
    owner: string,
    repo: string,
    filePath: string,
    sha: string,
    lineNumber: number,
    contextLines: number = 10,
  ): Promise<FileContentWithContext> {
    try {
      this.logger.debug(`Fetching file ${filePath} at ${sha.substring(0, 8)} for line ${lineNumber}`);

      const content = await this.getFileContent(owner, repo, filePath, sha);
      const lines = content.split('\n');

      const imports = this.extractImports(lines, filePath);

      const startLine = Math.max(0, lineNumber - contextLines - 1);
      const endLine = Math.min(lines.length, lineNumber + contextLines);

      const contextContent = lines.slice(startLine, endLine);

      return {
        lines: contextContent,
        startLineNumber: startLine + 1,
        targetLineNumber: lineNumber,
        endLineNumber: endLine,
        totalLines: lines.length,
        imports,
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch file context for ${filePath}:${lineNumber}: ${error.message}`);
      return {
        lines: [],
        startLineNumber: 0,
        targetLineNumber: lineNumber,
        endLineNumber: 0,
        totalLines: 0,
        imports: [],
      };
    }
  }

  /**
   * Extract import statements from file
   * Looks at first 50 lines for import/require statements
   */
  private extractImports(lines: string[], filePath: string): string[] {
    const imports: string[] = [];
    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    const patterns = {
      ts: /^\s*(import\s+|export\s+\{|from\s+['"]|const\s+.*=\s*require\(|type\s+\{)/,
      js: /^\s*(import\s+|export\s+\{|from\s+['"]|const\s+.*=\s*require\()/,
      py: /^\s*(import\s+|from\s+\S+\s+import\s+)/,
      java: /^\s*(import\s+|package\s+)/,
      go: /^\s*(import\s+[\("'])/,
      rs: /^\s*(use\s+)/,
      php: /^\s*(use\s+|require|include)/,
    };

    const pattern = patterns[ext] || patterns['ts'];

    let consecutiveNonImports = 0;
    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i].trim();

      if (!line || line.startsWith('//') || line.startsWith('/*') || line.startsWith('*') || line.startsWith('#')) {
        continue;
      }

      if (pattern.test(line)) {
        imports.push(lines[i]);
        consecutiveNonImports = 0;
      } else {
        consecutiveNonImports++;
        if (consecutiveNonImports >= 3) {
          break;
        }
      }
    }

    return imports;
  }

  /**
   * Get full file content at a specific commit SHA
   * Used by IssueVerifier for thorough checking
   */
  async getFileContent(
    owner: string,
    repo: string,
    filePath: string,
    sha: string,
  ): Promise<string> {
    try {
      this.logger.debug(`Fetching full file ${filePath} at ${sha.substring(0, 8)}`);

      const { data } = await this.client.rest.repos.getContent({
        owner,
        repo,
        path: filePath,
        ref: sha,
      });

      if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
        throw new Error(`${filePath} is not a readable file at ${sha}`);
      }

      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (error) {
      this.logger.warn(`Failed to fetch file ${filePath}: ${error.message}`);
      throw error;
    }
  }
}

/**
 * Inline comment data structure for GitHub PR review comments
 */
export interface InlineCommentData {
  filePath: string;
  oldPath: string;
  line: number;
  comment: string;
  baseSha: string;
  headSha: string;
  startSha: string;
}

/**
 * File content with context lines and imports
 */
export interface FileContentWithContext {
  lines: string[];
  startLineNumber: number;
  targetLineNumber: number;
  endLineNumber: number;
  totalLines: number;
  imports: string[];
}
