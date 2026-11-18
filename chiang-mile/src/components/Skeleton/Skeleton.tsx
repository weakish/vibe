import React from 'react'
import { cn } from '../../utils/style'

export interface SkeletonProps extends React.ComponentProps<"div"> {
    /** Additional CSS classes */
    className?: string
}

export function Skeleton({ className = '', ...props }: SkeletonProps) {
    return (
        <div
            className={cn(`animate-skeleton rounded-sm [--skeleton-highlight:--alpha(var(--color-white)/64%)] [background:linear-gradient(120deg,transparent_40%,var(--skeleton-highlight),transparent_60%)_var(--color-muted)_0_0/200%_100%_fixed] dark:[--skeleton-highlight:--alpha(var(--color-white)/4%)]`, className)}
            data-slot="skeleton"
            {...props}
        />
    )
}
