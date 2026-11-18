/**
 * Shared hooks for Speed App
 */

import React from 'react'
import type { SpeedAuthData } from '../speed-env'

/**
 * useAuth - Manages authentication state with Speed SDK
 *
 * Usage:
 * ```tsx
 * const { user, login, logout, authLoading, isAuthenticated } = useAuth()
 *
 * if (authLoading) return <div>Loading...</div>
 * if (!user) return <button onClick={login}>Login</button>
 * return <div>Welcome, {user.name}</div>
 * ```
 */
export function useAuth() {
	const [authData, setAuthData] = React.useState<SpeedAuthData | null>(null)
	const [authError, setAuthError] = React.useState<Error | null>(null)
	const [authLoading, setAuthLoading] = React.useState(true)

	React.useEffect(() => {
		checkAuthStatus()
	}, [])

	async function checkAuthStatus() {
		try {
			setAuthLoading(true)
			setAuthData(await speed.auth.getCurrentUser())
		} catch (error) {
			console.error('Error checking auth status:', error)
			setAuthError(error as Error)
		} finally {
			setAuthLoading(false)
		}
	}

	return {
		/** The authenticated user object, or undefined if not logged in */
		user: authData?.user,
		/** The auth token for API calls */
		token: authData?.token,
		/** The user's role: 'owner' | 'contributor' | 'readonly' | 'app-user' */
		role: authData?.role,
		/** Any authentication error that occurred */
		authError,
		/** True while checking authentication status */
		authLoading,
		/** True if user is authenticated */
		isAuthenticated: !!authData,
		/** Trigger login flow */
		login: () => speed.auth.login(),
		/** Log out the current user */
		logout: () => speed.auth.logout()
	}
}

/**
 * AuthGuard - Wrapper component that requires authentication
 *
 * Usage:
 * ```tsx
 * export default function MyProtectedPage() {
 *   return (
 *     <AuthGuard>
 *       <MyContent />
 *     </AuthGuard>
 *   )
 * }
 * ```
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
	const { authLoading, isAuthenticated, login } = useAuth()

	if (authLoading) {
		return (
			<div className="p-6 flex items-center justify-center">
				<div className="text-gray-500 dark:text-gray-400">
					Checking authentication...
				</div>
			</div>
		)
	}

	if (!isAuthenticated) {
		return (
			<div className="p-6 flex flex-col items-center justify-center gap-4">
				<div className="text-center">
					<h2 className="text-xl font-semibold mb-2">Authentication Required</h2>
					<p className="text-gray-500 dark:text-gray-400">
						Please login to access this feature
					</p>
				</div>
				<button
					onClick={login}
					className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
				>
					Login
				</button>
			</div>
		)
	}

	return <>{children}</>
}

/**
 * useTheme - Manages dark/light/auto theme preference
 *
 * Usage:
 * ```tsx
 * const { theme, setTheme, isDark } = useTheme()
 * ```
 */
export function useTheme() {
	const [theme, setThemeState] = React.useState<'light' | 'dark' | 'auto'>(() => {
		if (typeof window === 'undefined') return 'auto'
		const saved = localStorage.getItem('theme')
		return saved === 'light' || saved === 'dark' ? saved : 'auto'
	})

	const [isDark, setIsDark] = React.useState(false)

	React.useEffect(() => {
		localStorage.setItem('theme', theme)
		const query = window.matchMedia('(prefers-color-scheme: dark)')

		const applyTheme = (mode: 'light' | 'dark' | 'auto') => {
			const prefersDark = query.matches
			const enableDark = mode === 'dark' || (mode === 'auto' && prefersDark)
			document.documentElement.classList.toggle('dark', enableDark)
			document.documentElement.style.colorScheme = enableDark ? 'dark' : 'light'
			setIsDark(enableDark)
		}

		applyTheme(theme)

		if (theme === 'auto') {
			const listener = () => applyTheme('auto')
			query.addEventListener('change', listener)
			return () => query.removeEventListener('change', listener)
		}
		return
	}, [theme])

	return {
		/** Current theme setting: 'light' | 'dark' | 'auto' */
		theme,
		/** Update theme preference */
		setTheme: setThemeState,
		/** Whether dark mode is currently active */
		isDark
	}
}
