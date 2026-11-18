import { addons } from 'storybook/manager-api'

const ADDON_ID = 'custom-empty-state'

// Register the addon - injects CSS/JS to replace the EmptyIndexError
addons.register(ADDON_ID, () => {
    injectEmptyStateReplacer()
})

function injectEmptyStateReplacer() {
    const css = `
    /* Style for our custom empty state - replaces .sb-errordisplay_main content */
    .sb-errordisplay_main:has(> .custom-empty-state) {
      border: 0;
    }
    .custom-empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 40px;
      text-align: center;
      font-family: system-ui, -apple-system, sans-serif;
      color: #666;
    }

    .custom-empty-state-icon {
      font-size: 64px;
      margin-bottom: 24px;
      opacity: 0.8;
    }

    .custom-empty-state h2 {
      font-size: 24px;
      font-weight: 600;
      color: #333;
      margin: 0 0 12px 0;
    }

    .custom-empty-state p {
      font-size: 14px;
      line-height: 1.6;
      max-width: 400px;
      margin: 0 0 24px 0;
      color: #666;
    }

    .custom-empty-state code {
      padding: 12px 20px;
      background: rgba(0,0,0,0.05);
      border-radius: 6px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      color: #444;
    }
  `

    const style = document.createElement('style')
    style.innerHTML = css
    document.head.appendChild(style)

    // Create custom empty state HTML
    const customEmptyHTML = `
    <div class="custom-empty-state">
      <div class="custom-empty-state-icon">🧩</div>
      <h2>No Components Yet</h2>
      <p>This is your component library. Components will appear here as they are created.</p>
    </div>
  `

    // Try to replace in a given document context
    const replaceInDocument = (doc: Document): boolean => {
        // Already replaced in this document
        if (doc.querySelector('.custom-empty-state')) return true

        // Target the specific Storybook error display
        const errorDisplay = doc.querySelector('.sb-errordisplay.sb-wrapper')
        if (!errorDisplay) return false

        // Verify it's the "no stories" error by checking the heading
        const errorMessage = errorDisplay.querySelector('#error-message')
        if (!errorMessage?.textContent?.includes('stories')) return false

        // Replace the inner content (.sb-errordisplay_main)
        const mainContent = errorDisplay.querySelector('.sb-errordisplay_main')
        if (mainContent) {
            mainContent.innerHTML = customEmptyHTML
            return true
        }
        return false
    }

    // Check both main document and preview iframe
    const replaceEmptyState = () => {
        // Try main document first
        if (replaceInDocument(document)) return

        // Try preview iframe (error may render there)
        const iframe = document.getElementById('storybook-preview-iframe') as HTMLIFrameElement
        if (iframe?.contentDocument) {
            // Inject our CSS into the iframe too
            if (!iframe.contentDocument.querySelector('style[data-custom-empty-state]')) {
                const iframeStyle = iframe.contentDocument.createElement('style')
                iframeStyle.setAttribute('data-custom-empty-state', 'true')
                iframeStyle.innerHTML = css
                iframe.contentDocument.head?.appendChild(iframeStyle)
            }
            replaceInDocument(iframe.contentDocument)
        }
    }

    // Run on load and observe for changes
    const observer = new MutationObserver(() => {
        replaceEmptyState()
    })

    // Start observing once DOM is ready
    const startObserving = () => {
        observer.observe(document.body, { childList: true, subtree: true })
        replaceEmptyState()

        // Polling fallback for delayed rendering (every 500ms for 10 seconds)
        let attempts = 0
        const maxAttempts = 20
        const poll = setInterval(() => {
            replaceEmptyState()
            attempts++
            // Stop polling once replaced or max attempts reached
            if (document.querySelector('.custom-empty-state') || attempts >= maxAttempts) {
                clearInterval(poll)
            }
        }, 500)
    }

    if (document.body) {
        startObserving()
    } else {
        document.addEventListener('DOMContentLoaded', startObserving)
    }
}
