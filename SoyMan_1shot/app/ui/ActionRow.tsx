import type { HTMLAttributes, ReactNode } from 'react';

// ActionRow primitive (phase R1): the repeated `row oneshot-actions`
// flex context (~14 call sites). Same classes, same DOM — only the seam
// for the skin (row dividers / group ornaments via data-ui hooks).
export function ActionRow({ children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className="row oneshot-actions" data-ui="action-row" {...rest}>
      {children}
    </div>
  );
}
