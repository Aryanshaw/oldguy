import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[10px] bd font-black cursor-pointer select-none transition-transform active:translate-y-[2px] active:shadow-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-yk-black disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary: 'bg-yk-yellow sh text-yk-black',
        accent: 'bg-yk-orange sh text-yk-black',
        plain: 'bg-yk-white text-yk-black',
      },
      size: { default: 'px-[18px] py-2 text-sm', sm: 'px-3 py-1 text-xs' },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
