interface ImportMetaEnv {
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
  readonly SSR: boolean
  readonly BASE_URL: string
  [key: string]: unknown
}

// Augment the global ImportMeta interface
declare global {
  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}

export type SpeedAuthRole = 'owner' | 'contributor' | 'readonly' | 'app-user'

export interface SpeedAuthData {
  token: string // Will be automatically attached to all requests to the backend
  user: {
    id: string // User's unique ID
    name: string
    photoUrl: string
    email: string
  }
  role: SpeedAuthRole
}

export interface ImageGenerateOptions {
  prompt: string
  // Target width:height (e.g. "16:9"); mismatched output is centre-cropped
  forceRatio?: string
}

export interface ImageItem {
  url: string
}

export interface ImageGenerateResponse {
  created: number
  data: ImageItem[]
}

export interface ImageTransformOptions {
  prompt: string
  image: string // Source image URL or base64-encoded data URI
  // Target width:height (e.g. "16:9"); mismatched output is centre-cropped
  forceRatio?: string
}

export type ImageTransformResponse = ImageGenerateResponse

export interface IAPProduct {
  productKey: string
  name: string
  description?: string
  type: 'permanent' | 'consumable' | 'subscription'
  price: number
  currency: string
  // Consumables: units granted per purchase.
  quantity?: number
  // Subscriptions: access duration in days.
  durationDays?: number
}

export interface SpeedSDK {
  auth: {
    // Get the current authenticated user
    // Set `autoRedirect` to `true` to redirect to login page if not authenticated
    getCurrentUser(autoRedirect?: boolean): Promise<SpeedAuthData | null>
    // Redirect to login page to let the user login
    login(): void
    // Log out the current user and reload the page
    logout(): void
  }

  upload: {
    // Upload a file and get file's URL
    uploadFile(file: File): Promise<{ url: string }>
  }

  llm: {
    // OpenAI-compatible base URL of the Speed platform LLM endpoint.
    readonly baseURL: string
  }

  resources: {
    // Ensure the current user has at least this much grant remaining for the app.
    // For token grants, the amount is USD, not token count.
    requestGrant(resourceType?: 'token' | 'space', atLeast?: number): Promise<{ remaining: number }>
  }

  iap: {
    // Check whether the current user has access to a permanent or subscription product.
    // Consumables do not grant persistent access and will report an error.
    hasAccess(productKey: string): Promise<boolean>
    // List active IAP products configured for this app.
    listProducts(): Promise<IAPProduct[]>
    // Get one active IAP product by key.
    getProduct(productKey: string): Promise<IAPProduct | null>
    // Start a purchase flow for an IAP product and redirect to Speed checkout.
    purchase(productKey: string, redirectUrl?: string): Promise<void>
  }

  image: {
    // Generate an image from text prompt (text-to-image)
    generate(options: ImageGenerateOptions): Promise<ImageGenerateResponse>
    // Transform an existing image using AI (image-to-image)
    transform(options: ImageTransformOptions): Promise<ImageTransformResponse>
  }
}

declare global {
  // Speed SDK global instance, only available in frontend
  const speed: SpeedSDK
}
