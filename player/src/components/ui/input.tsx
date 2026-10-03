import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'w-full rounded-[10px] bd bg-yk-white px-3 py-2 text-sm font-bold text-yk-black placeholder:text-yk-black/50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-yk-black disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
