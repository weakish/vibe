import React from 'react'

export interface ButtonProps {
    /** Button content */
    children: React.ReactNode
    /** Visual variant */
    variant?: 'primary' | 'secondary' | 'outline'
    /** Size variant */
    size?: 'sm' | 'md' | 'lg'
    /** Disabled state */
    disabled?: boolean
    /** Click handler */
    onClick?: () => void
}

const variantClasses = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white border-transparent',
    secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100 border-transparent',
    outline: 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-100 border-gray-300 dark:border-gray-600',
}

const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
}

export function Button({
    children,
    variant = 'primary',
    size = 'md',
    disabled = false,
    onClick,
}: ButtonProps) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
        inline-flex items-center justify-center font-medium rounded-lg border transition-colors
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
        >
            {children}
        </button>
    )
}
