import { useState } from 'react';

/** Small copy-to-clipboard button - used on the fixed-code block and on
 * individual issue suggestions, since there was previously no way to grab
 * the AI's output without manually selecting text. */
export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail in insecure contexts/older browsers - fail quietly.
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      {copied ? '✓ Copied' : label}
    </button>
  );
}
