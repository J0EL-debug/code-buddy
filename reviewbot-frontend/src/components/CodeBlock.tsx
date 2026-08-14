import { Highlight, themes, type Language } from 'prism-react-renderer';

const EXT_TO_PRISM_LANG: Record<string, Language> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  py: 'python', java: 'java', go: 'go', rs: 'rust', rb: 'ruby',
  php: 'php', cs: 'csharp', cpp: 'cpp', c: 'c', kt: 'kotlin', swift: 'swift',
  sql: 'sql', sh: 'bash', html: 'markup', css: 'css', json: 'json',
  yaml: 'yaml', yml: 'yaml',
};

export function detectPrismLanguage(fileName: string): Language {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EXT_TO_PRISM_LANG[ext] || 'plaintext';
}

/**
 * Tokenized, syntax-highlighted code block matching the app's dark theme.
 * Renders each line with a number in the gutter; `lineProps` lets callers
 * (the error highlighter, the diff viewer) attach per-line classes/attrs
 * for severity tinting, active-line rings, or added/removed backgrounds.
 */
export function CodeBlock({
  code,
  fileName,
  lineProps,
  lineIds,
}: {
  code: string;
  fileName: string;
  lineProps?: (lineNumber: number) => { className?: string; style?: React.CSSProperties };
  lineIds?: boolean;
}) {
  const language = detectPrismLanguage(fileName);

  return (
    <Highlight code={code} language={language} theme={themes.vsDark}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <div className="font-mono-code text-xs" style={{ background: 'transparent' }}>
          {tokens.map((line, i) => {
            const lineNumber = i + 1;
            const extra = lineProps?.(lineNumber) || {};
            const { className: lineClassName, style: lineStyle, ...rest } = getLineProps({ line });
            return (
              <div
                key={i}
                {...rest}
                id={lineIds ? `cb-line-${lineNumber}` : undefined}
                className={`grid grid-cols-[3rem_1fr] items-start border-l-2 px-0 leading-5 ${lineClassName} ${extra.className || ''}`}
                style={{ borderLeftColor: 'transparent', ...lineStyle, ...extra.style }}
              >
                <span className="cb-gutter-number select-none py-0.5 pr-3 text-muted-foreground">{lineNumber}</span>
                <span className="whitespace-pre-wrap break-all py-0.5 pr-3">
                  {line.map((token, key) => {
                    const { className: tokenClassName, ...tokenRest } = getTokenProps({ token });
                    return <span key={key} {...tokenRest} className={tokenClassName} />;
                  })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Highlight>
  );
}
