import { addons } from 'storybook/manager-api'

import './addons/empty-state'

addons.setConfig({
  enableShortcuts: true,
  showToolbar: true,

  // Sidebar configuration
  sidebar: {
    showRoots: true,
  },

  // Toolbar configuration - hide share and editor buttons
  toolbar: {
    share: { hidden: true },
    remount: { hidden: false },
    zoom: { hidden: false },
    eject: { hidden: true },
    copy: { hidden: true },
    fullscreen: { hidden: false },
  },
})

// Custom CSS to hide unwanted UI elements
const css = `
  /* Hide sidebar header (logo + title) */
  .sidebar-header {
    display: none !important;
  }
  
  /* Hide Storybook "Get Started" onboarding/checklist widget */
  #storybook-checklist-widget,
  [aria-label="Open onboarding guide"],
  [aria-label*="onboarding"],
  #checklist-module,
  #checklist-module-collapse-toggle,
  [id*="checklist-module"] {
    display: none !important;
  }
  
  /* Hide sidebar bottom wrapper (version info, notifications) */
  #sidebar-bottom-wrapper,
  [class*="sidebar-bottom"],
  [class*="SidebarBottom"] {
    display: none !important;
  }
  
  /* Hide Share and Open in editor buttons */
  button[aria-label="Share"],
  button[aria-label="Open in editor"],
  button[aria-label="Create a new story"] {
    display: none !important;
  }
  
  /* Hide Actions and Interactions panel tabs */
  [id*="tab-storybook/actions/panel"],
  [id*="tab-storybook/interactions/panel"] {
    display: none !important;
  }
    
`

// Inject CSS immediately
const style = document.createElement('style')
style.innerHTML = css
document.head.appendChild(style)

// Also observe for dynamically added elements
const observer = new MutationObserver(() => {
  const widget = document.getElementById('storybook-checklist-widget')
  if (widget) {
    widget.style.display = 'none'
    // also hide its parent (3 levels)
    if (widget.parentElement) widget.parentElement.style.display = 'none'
    if (widget.parentElement?.parentElement) widget.parentElement.parentElement.style.display = 'none'
    if (widget.parentElement?.parentElement?.parentElement) widget.parentElement.parentElement.parentElement.style.display = 'none'
  }
})
observer.observe(document.body, { childList: true, subtree: true })

