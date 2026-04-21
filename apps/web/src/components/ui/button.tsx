import * as React from 'react';
import { cn } from '@/lib/cn';

type Variant = 'default' | 'secondary' | 'ghost' | 'destructive' | 'outline';
type Size = 'default' | 'sm' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-secondary hover:text-secondary-foreground',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-background hover:bg-secondary',
};

// M-4 WCAG 2.1 AA — minimum touch target 44×44 CSS px (level AAA).
// Level AA requires only 24×24 but mobile UX research (and the audit) use 44
// as the practical floor. `default` and `icon` now meet that; `sm` is kept
// below as an escape hatch for dense desktop tables — use sparingly, never
// as the primary action on a mobile-facing view.
const sizes: Record<Size, string> = {
  default: 'h-11 px-4 py-2',
  sm: 'h-9 rounded-md px-3 text-sm',
  lg: 'h-12 rounded-md px-8',
  icon: 'h-11 w-11',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
