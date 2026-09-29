'use client';

import 'katex/dist/katex.min.css';
import katex from 'katex';
import { Fragment, useMemo } from 'react';
import { splitMath } from '../lib/math';

/**
 * Text with LaTeX maths between `$…$`, mixed with Arabic (REQ-QBANK-001). Maths is rendered by
 * KaTeX (which escapes its input) and isolated left-to-right so it isn't reordered in RTL text.
 */
export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(
    () =>
      splitMath(text).map((p) =>
        p.math
          ? {
              math: true,
              html: katex.renderToString(p.value, { throwOnError: false, output: 'html' }),
            }
          : { math: false, value: p.value },
      ),
    [text],
  );
  return (
    <span className={`whitespace-pre-line ${className ?? ''}`}>
      {parts.map((p, i) =>
        p.math ? (
          <bdi key={i} dir="ltr" dangerouslySetInnerHTML={{ __html: p.html ?? '' }} />
        ) : (
          <Fragment key={i}>{p.value}</Fragment>
        ),
      )}
    </span>
  );
}
