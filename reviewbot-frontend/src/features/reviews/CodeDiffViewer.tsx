import { FileCode } from 'lucide-react';
import { DiffViewer } from '@/components/DiffViewer';

interface CodeDiffViewerProps {
  oldValue: string;
  newValue: string;
  fileName?: string;
  language?: string;
}

/**
 * Renders a before/after diff for a GitHub PR file. Uses the app's own
 * DiffViewer (built on the `diff` package) rather than a third-party
 * component, since that removes a dependency that only supported React up
 * to v18 and forced every `npm install` to need --legacy-peer-deps.
 */
export const CodeDiffViewer = ({ oldValue, newValue, fileName }: CodeDiffViewerProps) => {
  return (
    <div className="rounded-xl border border-border bg-card shadow-none">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <FileCode className="h-5 w-5 text-primary" />
        <h3 className="font-medium text-foreground">{fileName || 'Code Diff'}</h3>
      </div>
      <div className="p-2">
        <DiffViewer before={oldValue} after={newValue} fileName={fileName || 'file.txt'} />
      </div>
    </div>
  );
};
