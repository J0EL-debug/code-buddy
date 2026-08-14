import { useState } from 'react';
import { useProjects, useUpdateProject, useDeleteProject } from '@/hooks/api/useProjects';
import { FolderOpen, ExternalLink, TrendingUp, FileCheck, AlertTriangle, Settings, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';

export default function ProjectsPage() {
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: projectsData, isLoading, error } = useProjects({ page, limit: 10 });
  const updateProject = useUpdateProject();
  const deleteProject = useDeleteProject();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  if (isLoading) {
    return (
      <div className="py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
          <h1 className="text-title-lg font-semibold text-foreground dark:text-primary-foreground">Projects</h1>
          <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
            Manage GitHub repositories tracked by Code Buddy
          </p>
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
          <div className="mt-6 space-y-4">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-xl border border-border bg-secondary dark:border-gray-800 dark:bg-gray-800"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !projectsData) {
    return (
      <div className="py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
          <h1 className="text-title-lg font-semibold text-foreground dark:text-primary-foreground">Projects</h1>
          <div className="mt-6 rounded-xl border border-error-200 bg-error-50 p-6 dark:border-error-800 dark:bg-error-900/20">
            <p className="text-sm text-error-600 dark:text-error-400">
              Failed to load projects. Please try again.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { data: projects, meta } = projectsData;

  return (
    <div className="py-6">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-title-lg font-semibold text-foreground dark:text-primary-foreground">Projects</h1>
            <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
              {meta.total} GitHub {meta.total === 1 ? 'repository' : 'repositories'} tracked
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 md:px-8">
        {projects.length === 0 ? (
          <div className="mt-6 rounded-xl border border-border bg-card p-12 text-center dark:border-gray-800 dark:bg-gray-dark">
            <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground" />
            <h3 className="mt-2 font-display text-sm font-semibold text-foreground dark:text-primary-foreground">
              No GitHub repos connected yet
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground dark:text-muted-foreground">
              This mode reviews pull requests automatically whenever they're opened - set up a
              webhook on a GitHub repo to turn it on. In the meantime, you don't need this at all:
              you can review any code instantly, right now, with no setup.
            </p>
            <a
              href="/review"
              className="mt-4 inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Try Review Code instead →
            </a>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className="rounded-xl border border-border bg-card p-6 shadow-theme-sm transition hover:border-brand-300 dark:border-gray-800 dark:bg-gray-dark dark:hover:border-brand-700"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-100 dark:bg-brand-900/20">
                        <FolderOpen className="h-6 w-6 text-brand-600 dark:text-brand-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground dark:text-primary-foreground truncate">
                          {project.namespace}/{project.name}
                        </h3>
                        <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                          GitHub Repo ID: {project.githubRepoId}
                        </p>
                      </div>
                    </div>

                    {project.metrics && (
                      <div className="mt-4 flex flex-wrap gap-4">
                        <div className="flex items-center gap-2">
                          <FileCheck className="h-4 w-4 text-brand-500" />
                          <span className="text-sm text-foreground dark:text-gray-300">
                            <span className="font-semibold">{project.metrics.totalReviews}</span> reviews
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-success-500" />
                          <span className="text-sm text-foreground dark:text-gray-300">
                            Avg score: <span className="font-semibold">{project.metrics.averageScore.toFixed(1)}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-warning-500" />
                          <span className="text-sm text-foreground dark:text-gray-300">
                            <span className="font-semibold">{project.metrics.totalIssues}</span> issues
                          </span>
                        </div>
                        {project.metrics.lastReviewAt && (
                          <span className="text-sm text-muted-foreground dark:text-muted-foreground">
                            Last review: {new Date(project.metrics.lastReviewAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="ml-4 flex flex-col items-end gap-2">
                    <Badge variant={project.isActive ? 'success' : 'secondary'}>
                      {project.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedId(expandedId === project.id ? null : project.id)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Review settings"
                      >
                        <Settings className="h-5 w-5" />
                      </button>
                      <a
                        href={`https://github.com/${project.namespace}/${project.name}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-500 hover:text-brand-600 dark:hover:text-brand-400"
                      >
                        <ExternalLink className="h-5 w-5" />
                      </a>
                      <button
                        onClick={() => setDeleteTarget({ id: project.id, name: `${project.namespace}/${project.name}` })}
                        className="text-muted-foreground hover:text-[#FF6B6B]"
                        title="Delete project"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>

                {expandedId === project.id && (
                  <ProjectSettingsPanel
                    project={project}
                    onSave={(fields) => updateProject.mutate({ id: project.id, project: fields })}
                    isSaving={updateProject.isPending}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {meta.totalPages > 1 && (
          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              Showing {((page - 1) * meta.limit) + 1} to {Math.min(page * meta.limit, meta.total)} of{' '}
              {meta.total} projects
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-muted-foreground dark:hover:bg-gray-800"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                disabled={page === meta.totalPages}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:text-muted-foreground dark:hover:bg-gray-800"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this project?"
        message={`"${deleteTarget?.name}" and its review history will be permanently removed. This can't be undone.`}
        onConfirm={() => {
          if (deleteTarget) deleteProject.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

interface ProjectSettingsPanelProps {
  project: { minMergeScore?: number | null; styleGuide?: string | null };
  onSave: (fields: { minMergeScore: number | null; styleGuide: string | null }) => void;
  isSaving: boolean;
}

/**
 * Per-project review configuration: the merge gate threshold and a custom
 * style guide appended to the AI's review prompt. Also surfaces the
 * "/codebuddy recheck" comment command, since there's nowhere else in the
 * UI a user would discover it.
 */
function ProjectSettingsPanel({ project, onSave, isSaving }: ProjectSettingsPanelProps) {
  const [gateEnabled, setGateEnabled] = useState(project.minMergeScore != null);
  const [minMergeScore, setMinMergeScore] = useState(project.minMergeScore ?? 70);
  const [styleGuide, setStyleGuide] = useState(project.styleGuide ?? '');

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-border bg-background/50 p-4">
      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-foreground">
          <input
            type="checkbox"
            checked={gateEnabled}
            onChange={(e) => setGateEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Merge gate
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          When enabled, PRs scoring below the threshold get a formal "Request changes" review
          instead of just a comment (works with GitHub branch protection rules requiring approval).
        </p>
        {gateEnabled && (
          <div className="mt-2 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Minimum score:</span>
            <input
              type="number"
              min={0}
              max={100}
              value={minMergeScore}
              onChange={(e) => setMinMergeScore(Number(e.target.value))}
              className="w-20 rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground"
            />
          </div>
        )}
      </div>

      <div>
        <label className="text-sm font-medium text-foreground">Custom review conventions</label>
        <p className="mt-1 text-xs text-muted-foreground">
          Optional project-specific rules appended to the AI's review prompt (e.g. "require JSDoc on
          exported functions").
        </p>
        <textarea
          value={styleGuide}
          onChange={(e) => setStyleGuide(e.target.value)}
          rows={3}
          placeholder="e.g. Require JSDoc comments on all exported functions..."
          className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        💬 Comment <code className="font-mono-code text-primary">/codebuddy recheck</code> on any open
        PR in this repo to trigger a fresh review after pushing fixes.
      </div>

      <button
        onClick={() =>
          onSave({
            minMergeScore: gateEnabled ? minMergeScore : null,
            styleGuide: styleGuide.trim() || null,
          })
        }
        disabled={isSaving}
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
      >
        {isSaving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
