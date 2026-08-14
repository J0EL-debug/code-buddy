import { diffLines } from 'diff';
import { detectPrismLanguage } from './CodeBlock';
import { Highlight, themes } from 'prism-react-renderer';

/**
 * Line-level before/after diff (red for removed, green for added) between
 * the original code and the AI's fixed version - much easier to evaluate
 * a fix at a glance than two separate flat code blocks.
 */
export function DiffViewer({ before, after, fileName }: { before: string; after: string; fileName: string }) {
  const parts = diffLines(before, after);
  const language = detectPrismLanguage(fileName);

  return (
    <div className="max-h-[32rem] overflow-y-auto overflow-x-auto rounded-xl border border-border bg-card">
      <div className="font-mono-code text-xs">
        {parts.map((part, partIdx) => {
          const lines = part.value.replace(/\n$/, '').split('\n');
          const bg = part.added ? 'bg-[#5EEAD4]/10' : part.removed ? 'bg-[#FF6B6B]/10' : '';
          const marker = part.added ? '+' : part.removed ? '-' : ' ';
          const markerColor = part.added ? 'text-primary' : part.removed ? 'text-[#FF6B6B]' : 'text-muted-foreground';

          return lines.map((line, lineIdx) => (
            <div
              key={`${partIdx}-${lineIdx}`}
              className={`grid grid-cols-[2rem_1fr] items-start px-0 leading-5 ${bg}`}
            >
              <span className={`select-none py-0.5 pl-3 pr-2 ${markerColor}`}>{marker}</span>
              <Highlight code={line} language={language} theme={themes.vsDark}>
                {({ tokens, getTokenProps }) => (
                  <span className="whitespace-pre-wrap break-all py-0.5 pr-3">
                    {tokens[0]?.map((token, key) => {
                      const { className, ...rest } = getTokenProps({ token });
                      return <span key={key} {...rest} className={className} />;
                    })}
                  </span>
                )}
              </Highlight>
            </div>
          ));
        })}
      </div>
    </div>
  );
}
