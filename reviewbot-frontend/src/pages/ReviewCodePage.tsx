import { useState, useRef, useEffect } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CopyButton } from '@/components/CopyButton';
import { CodeBlock } from '@/components/CodeBlock';
import { DiffViewer } from '@/components/DiffViewer';
import { requestNotificationPermission } from '@/components/ToastProvider';
import {
  useSubmitPastedCode,
  useSubmitFileUpload,
  useRecentAdhocReviews,
  usePollAdhocReview,
  usePollAdhocBatch,
  useDeleteAdhocReview,
  useDeleteAdhocBatch,
  type AdhocReview,
  type AdhocMode,
  type AdhocBatchSummary,
} from '@/hooks/api/useAdhocReview';

type Mode = 'paste' | 'upload';

const DRAFT_KEY = 'codebuddy:review-draft';
const ACTIVE_ID_KEY = 'codebuddy:review-active-id';
const ACTIVE_BATCH_KEY = 'codebuddy:review-active-batch';
const MAX_INLINE_CODE_LINES = 3000;

const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const SEVERITY_DOT: Record<string, string> = {
  critical: 'bg-[#FF6B6B]',
  high: 'bg-[#FFB454]',
  medium: 'bg-[#7DD3FC]',
  low: 'bg-[#8B92A3]',
};

const SEVERITY_LINE_BG: Record<string, string> = {
  critical: 'bg-[#FF6B6B]/10',
  high: 'bg-[#FFB454]/10',
  medium: 'bg-[#7DD3FC]/10',
  low: 'bg-[#8B92A3]/10',
};

const SEVERITY_WEIGHT: Record<string, number> = { critical: 1000, high: 100, medium: 10, low: 1 };

function sortByImportance(reviews: AdhocReview[]): AdhocReview[] {
  const importance = (r: AdhocReview) => {
    if (r.status === 'FAILED') return Number.MAX_SAFE_INTEGER;
    if (r.status !== 'COMPLETED') return -1;
    return (r.issues || []).reduce((sum, i) => sum + (SEVERITY_WEIGHT[i.severity] ?? 1), 0);
  };
  return reviews.slice().sort((a, b) => importance(b) - importance(a));
}

function ScoreDial({ score }: { score: number }) {
  const color = score >= 90 ? '#5EEAD4' : score >= 70 ? '#FFB454' : '#FF6B6B';
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-5">
      <span className="font-display text-4xl font-bold" style={{ color }}>
        {score}
      </span>
      <span className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">Quality score</span>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 90 ? '#5EEAD4' : score >= 70 ? '#FFB454' : '#FF6B6B';
  return (
    <span
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {score}
    </span>
  );
}

function StatusBanner({ status }: { status: AdhocReview['status'] }) {
  if (status === 'COMPLETED' || status === 'FAILED') return null;
  const label = status === 'PROCESSING' ? 'Code Buddy is reviewing this now…' : 'Queued for review…';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function ProjectBrief({ summary }: { summary: AdhocBatchSummary | null | undefined }) {
  if (!summary) return null;
  if (summary.status !== 'COMPLETED') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        <span className="text-sm text-muted-foreground">Synthesizing overall project brief…</span>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-5">
      <div className="flex items-start gap-4">
        <ScoreDial score={summary.overallScore ?? 0} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">Project overview</p>
          <p className="text-sm text-foreground">{summary.overallBrief}</p>
        </div>
      </div>
    </div>
  );
}

/** Visual progress bar for a zip batch, replacing the plain "X/Y done" text
 * with something that reads at a glance. */
function BatchProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{completed}/{total} files done</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ReviewCard({ review }: { review: AdhocReview }) {
  const [activeLine, setActiveLine] = useState<number | null>(null);

  if (review.status === 'FAILED') {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-mono-code text-sm text-foreground">{review.fileName}</p>
        <p className="mt-1 text-sm text-[#FF6B6B]">{review.errorMessage || 'Review failed'}</p>
      </div>
    );
  }

  if (review.status !== 'COMPLETED') {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="font-mono-code text-sm text-foreground mb-2">{review.fileName}</p>
        <StatusBanner status={review.status} />
      </div>
    );
  }

  const issues = review.issues || [];
  const code = review.code || '';
  const lineCount = code.split('\n').length;

  const jumpToLine = (line: number) => {
    setActiveLine(line);
    const el = document.getElementById(`cb-line-${line}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => setActiveLine((cur) => (cur === line ? null : cur)), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-display text-lg font-semibold text-foreground">{review.topic || review.fileName}</h3>
          <p className="text-sm text-muted-foreground font-mono-code">{review.fileName}</p>
          <p className="text-sm text-muted-foreground mt-1">{review.language} &middot; {review.summary}</p>
        </div>
        <ScoreDial score={review.score ?? 100} />
      </div>

      {review.recommendation && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-1">Recommendation</p>
          <p className="text-sm text-foreground">{review.recommendation}</p>
        </div>
      )}

      {issues.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="font-display text-lg font-semibold text-primary">Looks clean 🎉</p>
          <p className="mt-1 text-sm text-muted-foreground">Code Buddy didn't find anything worth flagging.</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {issues
              .slice()
              .sort((a, b) => a.line - b.line)
              .map((issue, idx) => (
                <div
                  key={idx}
                  className="cb-gutter-line border-b border-border/60 px-0 py-3 last:border-b-0"
                  data-severity={issue.severity}
                >
                  <button onClick={() => jumpToLine(issue.line)} className="cb-gutter-number pt-0.5 text-left underline decoration-dotted">
                    {issue.line}
                  </button>
                  <div className="pr-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${SEVERITY_DOT[issue.severity]}`} />
                        <span className="font-mono-code text-xs uppercase tracking-wide text-muted-foreground">
                          {SEVERITY_LABEL[issue.severity]} &middot; {issue.type}
                        </span>
                      </div>
                      <CopyButton text={issue.suggestion} label="Copy fix" />
                    </div>
                    <p className="mt-1 font-sans text-sm text-foreground">{issue.message}</p>
                    <p className="mt-1 font-sans text-sm text-muted-foreground">
                      <span className="text-primary">Suggestion:</span> {issue.suggestion}
                    </p>
                  </div>
                </div>
              ))}
          </div>

          {code && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Your code, with issues highlighted
              </p>
              {lineCount > MAX_INLINE_CODE_LINES ? (
                <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                  This file is too large to display inline ({lineCount.toLocaleString()} lines) - issues are still listed above with their line numbers.
                </div>
              ) : (
                <CodeBlock
                  code={code}
                  fileName={review.fileName}
                  lineIds
                  lineProps={(lineNumber) => {
                    const issue = issues.find((i) => i.line === lineNumber);
                    const isActive = activeLine === lineNumber;
                    return {
                      className: `${issue ? SEVERITY_LINE_BG[issue.severity] : ''} ${isActive ? 'ring-2 ring-inset ring-primary' : ''}`,
                      style: issue ? { borderLeftColor: { critical: '#FF6B6B', high: '#FFB454', medium: '#7DD3FC', low: '#8B92A3' }[issue.severity] } : undefined,
                    };
                  }}
                />
              )}
            </div>
          )}
        </>
      )}

      {review.mode === 'fix' && review.fixedCode && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {code ? 'Diff — original vs. fixed' : 'Fixed code'}
            </p>
            <CopyButton text={review.fixedCode} label="Copy fixed code" />
          </div>
          {code ? (
            <DiffViewer before={code} after={review.fixedCode} fileName={review.fileName} />
          ) : (
            <div className="mb-3 rounded-xl border border-border bg-card p-4">
              <CodeBlock code={review.fixedCode} fileName={review.fileName} />
            </div>
          )}
          {review.changes && review.changes.length > 0 && (
            <div className="mt-3 rounded-xl border border-border bg-card p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What changed</p>
              <ul className="space-y-2">
                {review.changes.map((c, idx) => (
                  <li key={idx} className="flex gap-2 text-sm text-foreground">
                    <span className="text-primary">•</span>
                    <span>{c.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleFileReview({ review, defaultOpen }: { review: AdhocReview; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const issues = review.issues || [];
  const severityCounts = issues.reduce<Record<string, number>>((acc, i) => {
    acc[i.severity] = (acc[i.severity] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="rounded-xl border border-border bg-card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {review.status === 'COMPLETED' ? (
          <ScoreBadge score={review.score ?? 100} />
        ) : (
          <span className="h-7 w-7 shrink-0 rounded-full border border-border" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{review.topic || review.fileName}</p>
          <p className="truncate font-mono-code text-xs text-muted-foreground">{review.fileName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {(['critical', 'high', 'medium', 'low'] as const).map((sev) =>
            severityCounts[sev] ? (
              <span key={sev} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${SEVERITY_LINE_BG[sev]}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT[sev]}`} />
                {severityCounts[sev]}
              </span>
            ) : null,
          )}
          {review.status === 'COMPLETED' && issues.length === 0 && <span className="text-xs text-primary">clean</span>}
        </div>
        <span className="shrink-0 text-muted-foreground">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 py-4">
          <ReviewCard review={review} />
        </div>
      )}
    </div>
  );
}

export default function ReviewCodePage() {
  const [mode, setMode] = useState<Mode>('paste');
  const [aiMode, setAiMode] = useState<AdhocMode>('review');
  const [fileName, setFileName] = useState('');
  const [code, setCode] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<{ type: 'single' | 'batch'; key: string; label: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const draft = sessionStorage.getItem(DRAFT_KEY);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        setFileName(parsed.fileName ?? '');
        setCode(parsed.code ?? '');
        setAiMode(parsed.aiMode ?? 'review');
      } catch {
        /* ignore corrupt draft */
      }
    }
    setActiveId(sessionStorage.getItem(ACTIVE_ID_KEY));
    setActiveBatchId(sessionStorage.getItem(ACTIVE_BATCH_KEY));
  }, []);

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ fileName, code, aiMode }));
  }, [fileName, code, aiMode]);

  const pasteMutation = useSubmitPastedCode();
  const uploadMutation = useSubmitFileUpload();
  const { data: recent } = useRecentAdhocReviews();
  const polledReview = usePollAdhocReview(activeId);
  const { reviews: polledBatch, summary: batchSummary } = usePollAdhocBatch(activeBatchId);
  const deleteReview = useDeleteAdhocReview();
  const deleteBatch = useDeleteAdhocBatch();

  const [uploadError, setUploadError] = useState<string | null>(null);
  const isSubmitting = pasteMutation.isPending || uploadMutation.isPending;
  const error = pasteMutation.error || uploadMutation.error;

  const startSingle = (id: string) => {
    setActiveBatchId(null);
    sessionStorage.removeItem(ACTIVE_BATCH_KEY);
    setActiveId(id);
    sessionStorage.setItem(ACTIVE_ID_KEY, id);
  };

  const startBatch = (batchId: string) => {
    setActiveId(null);
    sessionStorage.removeItem(ACTIVE_ID_KEY);
    setActiveBatchId(batchId);
    sessionStorage.setItem(ACTIVE_BATCH_KEY, batchId);
  };

  const startNew = () => {
    setActiveId(null);
    setActiveBatchId(null);
    sessionStorage.removeItem(ACTIVE_ID_KEY);
    sessionStorage.removeItem(ACTIVE_BATCH_KEY);
    setFileName('');
    setCode('');
  };

  const handleSubmitPaste = async () => {
    if (!code.trim()) return;
    const data = await pasteMutation.mutateAsync({ fileName: fileName || 'snippet.js', code, mode: aiMode });
    startSingle(data.id);
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmitPaste();
    }
  };

  const submitFile = async (file: File) => {
    setUploadError(null);
    try {
      const data = await uploadMutation.mutateAsync({ file, mode: aiMode });
      if (data && 'batchId' in data && data.batchId) {
        startBatch(data.batchId);
      } else if (data && 'id' in data) {
        startSingle(data.id);
      }
    } catch (err: any) {
      const raw = err?.response?.data?.message;
      const msg = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(', ') : 'Could not process that file. Please try a different one.';
      setUploadError(msg);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await submitFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) await submitFile(file);
  };

  const showBatch = !!(activeBatchId && Array.isArray(polledBatch) && polledBatch.length > 0);
  const showSingle = !!(activeId && polledReview);
  const showComposer = !showBatch && !showSingle;

  const grouped = Object.values(
    (recent || []).reduce<Record<string, AdhocReview[]>>((groups, r) => {
      const key = r.batchId || r.id;
      groups[key] = groups[key] || [];
      groups[key].push(r);
      return groups;
    }, {}),
  );

  const handleConfirmDelete = () => {
    if (!confirmTarget) return;
    if (confirmTarget.type === 'batch') {
      deleteBatch.mutate(confirmTarget.key);
      if (activeBatchId === confirmTarget.key) startNew();
    } else {
      deleteReview.mutate(confirmTarget.key);
      if (activeId === confirmTarget.key) startNew();
    }
    setConfirmTarget(null);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="p-3">
          <button
            onClick={startNew}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary/40"
          >
            + New review
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {grouped.length === 0 && <p className="px-2 py-4 text-sm text-muted-foreground">No reviews yet</p>}
          {grouped.map((group) => {
            const first = group[0];
            const isBatch = group.length > 1 || !!first.batchId;
            const isActive = isBatch ? first.batchId === activeBatchId : first.id === activeId;
            return (
              <div
                key={first.batchId || first.id}
                className={`group mb-1 flex items-center rounded-lg ${isActive ? 'bg-primary/10 border border-primary/30' : 'hover:bg-secondary/40'}`}
              >
                <button
                  onClick={() => (isBatch && first.batchId ? startBatch(first.batchId) : startSingle(first.id))}
                  className="min-w-0 flex-1 px-3 py-2 text-left"
                >
                  <p className="truncate text-sm text-foreground">
                    {first.topic || first.fileName}
                    {isBatch && <span className="ml-1 text-xs text-muted-foreground">({group.length})</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(first.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </button>
                <button
                  onClick={() =>
                    setConfirmTarget(
                      isBatch && first.batchId
                        ? { type: 'batch', key: first.batchId, label: first.topic || first.fileName }
                        : { type: 'single', key: first.id, label: first.topic || first.fileName },
                    )
                  }
                  className="mr-2 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-[#FF6B6B] group-hover:opacity-100"
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </aside>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
          {showComposer && (
            <>
              <div className="mb-8">
                <h1 className="font-display text-3xl font-bold text-foreground">Review your code</h1>
                <p className="mt-2 text-muted-foreground">
                  Paste a snippet, upload a file, or drop in a whole zip — no repo, no pull request, no webhook.
                </p>
                <button
                  onClick={requestNotificationPermission}
                  className="mt-2 text-xs text-muted-foreground underline decoration-dotted hover:text-primary"
                >
                  Notify me when a review finishes (even if I switch tabs)
                </button>
              </div>

              <div className="mb-4 flex flex-wrap gap-4">
                <div className="rounded-xl border border-border bg-card p-1 inline-flex gap-1">
                  <button
                    onClick={() => setMode('paste')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${mode === 'paste' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Paste code
                  </button>
                  <button
                    onClick={() => setMode('upload')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${mode === 'upload' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Upload a file or .zip
                  </button>
                </div>

                <div className="rounded-xl border border-border bg-card p-1 inline-flex gap-1">
                  <button
                    onClick={() => setAiMode('review')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${aiMode === 'review' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Review only
                  </button>
                  <button
                    onClick={() => setAiMode('fix')}
                    className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${aiMode === 'fix' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Review &amp; fix
                  </button>
                </div>
              </div>

              {mode === 'paste' ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="filename.js (optional)"
                    className="w-full rounded-lg border border-border bg-card px-4 py-2 font-mono-code text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <textarea
                    ref={textareaRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={handleTextareaKeyDown}
                    placeholder="Paste your code here... (Ctrl/Cmd+Enter to submit)"
                    rows={14}
                    className="w-full resize-y rounded-lg border border-border bg-card px-4 py-3 font-mono-code text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={handleSubmitPaste}
                    disabled={isSubmitting || !code.trim()}
                    className="inline-flex items-center rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmitting ? 'Submitting…' : aiMode === 'fix' ? 'Review & fix this code' : 'Review this code'}
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
                    isDragging ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary'
                  }`}
                >
                  <p className="font-display text-lg font-semibold text-foreground">
                    {isDragging ? 'Drop it here!' : 'Drop a file or .zip here, or click to browse'}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">Single file, or a .zip of a project (up to ~60 source files)</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".zip,.js,.jsx,.ts,.tsx,.mjs,.cjs,.vue,.svelte,.py,.java,.go,.rs,.rb,.php,.cs,.cpp,.cc,.c,.h,.hpp,.kt,.swift,.scala,.dart,.sql,.sh,.bash,.ps1,.html,.css,.scss,.less,.json,.yaml,.yml"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  {isSubmitting && <p className="mt-4 text-sm text-primary">Uploading…</p>}
                </div>
              )}

              {(error || uploadError) && (
                <p className="mt-3 text-sm text-[#FF6B6B]">
                  {(() => {
                    const msg = uploadError || (error as any)?.response?.data?.message;
                    if (typeof msg === 'string') return msg;
                    if (Array.isArray(msg)) return msg.join(', ');
                    return 'Something went wrong. Please try again.';
                  })()}
                </p>
              )}
            </>
          )}

          {showSingle && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <button onClick={startNew} className="text-sm text-primary hover:underline">
                  ← New review
                </button>
                <button
                  onClick={() => setConfirmTarget({ type: 'single', key: polledReview!.id, label: polledReview!.topic || polledReview!.fileName })}
                  className="text-sm text-muted-foreground hover:text-[#FF6B6B]"
                >
                  Delete
                </button>
              </div>
              <ErrorBoundary>
                <ReviewCard review={polledReview!} />
              </ErrorBoundary>
            </div>
          )}

          {showBatch && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <button onClick={startNew} className="text-sm text-primary hover:underline">
                  ← New review
                </button>
                <button
                  onClick={() => setConfirmTarget({ type: 'batch', key: activeBatchId!, label: batchSummary?.overallBrief ? 'this zip review' : 'this batch' })}
                  className="text-sm text-muted-foreground hover:text-[#FF6B6B]"
                >
                  Delete batch
                </button>
              </div>

              <BatchProgressBar completed={polledBatch.filter((r) => r.status === 'COMPLETED' || r.status === 'FAILED').length} total={polledBatch.length} />

              <ErrorBoundary>
                <ProjectBrief summary={batchSummary} />
              </ErrorBoundary>

              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Files below are sorted by severity — the ones needing attention are at the top
              </p>

              {sortByImportance(polledBatch).map((r, idx) => (
                <ErrorBoundary key={r.id}>
                  <CollapsibleFileReview review={r} defaultOpen={idx === 0} />
                </ErrorBoundary>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmTarget}
        title="Delete this review?"
        message={`"${confirmTarget?.label}" will be permanently removed. This can't be undone.`}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
