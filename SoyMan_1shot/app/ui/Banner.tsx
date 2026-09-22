import type { HTMLAttributes, ReactNode } from 'react';

// Banner primitive (phase R1): the three loudness levels as one contract.
// error → blocking alert (oneshot-error[role=alert]); hint → passive muted
// line. The sticky PWA update banner stays bespoke (single use, §4).
export type BannerTone = 'error' | 'hint';

export interface BannerProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  tone?: BannerTone;
  as?: 'p' | 'div';
  children: ReactNode;
}

export function Banner({ tone = 'error', as = 'div', children, ...rest }: BannerProps) {
  if (tone === 'hint') {
    const HintTag = as;
    return (
      <HintTag className="muted" data-ui="banner" data-tone="hint" {...rest}>
        {children}
      </HintTag>
    );
  }
  const ErrorTag = as;
  return (
    <ErrorTag className="oneshot-error" role="alert" data-ui="banner" data-tone="error" {...rest}>
      {children}
    </ErrorTag>
  );
}
