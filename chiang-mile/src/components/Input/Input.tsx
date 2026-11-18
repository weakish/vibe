import React from 'react'

export interface InputProps {
    /** Input label */
    label?: string
    /** Placeholder text */
    placeholder?: string
    /** Input value */
    value?: string
    /** Change handler */
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    /** Input type */
    type?: 'text' | 'email' | 'password' | 'number'
    /** Error message */
    error?: string
    /** Disabled state */
    disabled?: boolean
    /** Helper text */
    helperText?: string
}

export function Input({
    label,
    placeholder,
    value,
    onChange,
    type = 'text',
    error,
    disabled = false,
    helperText,
}: InputProps) {
    return (
        <div className="w-full">
            {label && (
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    {label}
                </label>
            )}
            <input
                type={type}
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                disabled={disabled}
                className={`
          w-full px-3 py-2 rounded-lg border transition-colors
          bg-white dark:bg-gray-900
          text-gray-900 dark:text-gray-100
          placeholder-gray-400 dark:placeholder-gray-500
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
          ${error
                        ? 'border-red-500 dark:border-red-500'
                        : 'border-gray-300 dark:border-gray-700'
                    }
          ${disabled ? 'opacity-50 cursor-not-allowed bg-gray-100 dark:bg-gray-800' : ''}
        `}
            />
            {error && (
                <p className="mt-1.5 text-sm text-red-500">{error}</p>
            )}
            {helperText && !error && (
                <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{helperText}</p>
            )}
        </div>
    )
}
