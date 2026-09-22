import type { ButtonHTMLAttributes, ReactNode } from 'react';

// Button primitive (phase R1): the only contract is variant + busy +
// disabled. Visuals come from the shared client button classes, so this
// component changes nothing rendered today — it fixes the call-site
// vocabulary for the skin redesign (variant explosion forbidden: exactly
// primary / secondary / danger; ghost is deferred — no ghost class exists).
// Decoration hooks: [data-ui="button"]::before/::after (components.css).
export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  busy?: boolean;
  children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  primary: 'primary',
  secondary: undefined,
  danger: 'danger',
};

export function Button({ variant = 'secondary', busy = false, disabled, children, ...rest }: ButtonProps) {
  return (
    <button
      data-ui="button"
      data-variant={variant}
      className={VARIANT_CLASS[variant]}
      disabled={disabled || busy}
      {...rest}
    >
      {children}
    </button>
  );
}
