import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { zValidator } from 'speed-framework'
import { jwtVerify } from 'jose'

// =============================================================================
// IAP CALLBACK ENDPOINT - PLATFORM INTEGRATION (DO NOT MODIFY STRUCTURE)
// =============================================================================
//
// ⚠️  CRITICAL FOR AI AGENTS:
// ─────────────────────────────────────────────────────────────────────────────
// This file receives callbacks from the Speed platform when IAP purchases complete.
// The platform sends requests in a FIXED FORMAT that CANNOT be changed.
//
// DO NOT:
// ❌ Change the endpoint path (/speed-callbacks/iap)
// ❌ Modify the request body schema ({ result: string })
// ❌ Change the JWT verification logic
// ❌ Create alternative callback endpoints elsewhere
// ❌ Write your own IAP callback handler in a different file
//
// DO:
// ✅ ONLY add your business logic in the "TODO" section below
// ✅ Use the payload data to update your app's state (e.g., grant credits, unlock features)
// ✅ Keep this file as the single IAP callback handler
// ✅ Errors: throw HTTPException → framework returns { message: string } with the status code
// ✅ Success/failure is indicated by HTTP status only (2xx vs 4xx), not a success field in the body
//
// The platform will POST to this exact endpoint with this exact request format.
// Any modifications to the request structure will cause callbacks to fail silently.
// ─────────────────────────────────────────────────────────────────────────────
//
// Events:
// - iap_purchase_completed: Entitlement granted after payment
// - iap_subscription_renewed: Subscription extended (future)
//
// =============================================================================

const iapCallbackPayloadSchema = z.object({
  type: z.enum(['iap_purchase_completed', 'iap_subscription_renewed']),
  purchaseId: z.number(),
  userId: z.string(),
  appId: z.number(),
  status: z.string(),
  expiresAt: z.string().nullable().optional(),  // for subscriptions
  productId: z.number(),
  productKey: z.string(),
  productName: z.string(),
  productType: z.enum(['permanent', 'consumable', 'subscription']),
  price: z.number(),
  quantity: z.number().nullable(),  // for consumables: units to grant
  daysRemaining: z.number().nullable().optional(),  // for subscriptions
  grantedAt: z.string(),
}).superRefine((payload, ctx) => {
  if (payload.productType === 'consumable' && payload.quantity === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['quantity'],
      message: 'quantity is required for consumable purchases',
    })
  }
})

export type IapCallbackPayload = z.infer<typeof iapCallbackPayloadSchema>

export const routes = new Hono()
  .basePath('/speed-callbacks/iap')

  .post('/', zValidator('json', z.object({ result: z.string() })), async ctx => {
    const { result } = ctx.req.valid('json')

    // Verify JWT and extract payload using app's unique key
    let payload: IapCallbackPayload
    try {
      const secret = new TextEncoder().encode(process.env.SPEED_APP_KEY!)
      const { payload: jwtPayload } = await jwtVerify(result, secret)
      payload = jwtPayload as unknown as IapCallbackPayload
    } catch {
      throw new HTTPException(401, { message: 'Invalid signature' })
    }

    // Validate payload schema
    const parsed = iapCallbackPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      throw new HTTPException(400, { message: 'Invalid payload' })
    }

    // =========================================================================
    // 👇 ADD YOUR BUSINESS LOGIC HERE (this is the ONLY section to modify)
    // =========================================================================
    //
    // Available data in payload:
    // - payload.purchaseId: Unique purchase id — USE THIS AS AN IDEMPOTENCY KEY
    // - payload.type: 'iap_purchase_completed' | 'iap_subscription_renewed'
    // - payload.userId: The user who made the purchase
    // - payload.productKey: The product identifier (e.g., 'coins_100')
    // - payload.productType: 'permanent' | 'consumable' | 'subscription'
    // - payload.quantity: Units to grant for consumables (the product's quantity)
    // - payload.expiresAt / payload.daysRemaining: Subscription expiry info
    //
    // ⚠️ IDEMPOTENCY: This callback may be retried, so the SAME purchaseId can
    // arrive more than once. For consumables especially, granting on every call
    // double-credits the user. Record processed payload.purchaseId values and
    // skip duplicates before applying any effect.
    //
    // Example: grant credits for a consumable, exactly once
    // ```
    // if (payload.type === 'iap_purchase_completed' && payload.productType === 'consumable') {
    //   const inserted = await db
    //     .insert(processedCallbacks)
    //     .values({ purchaseId: payload.purchaseId })
    //     .onConflictDoNothing()
    //     .returning()
    //   if (inserted.length > 0) {
    //     await addCreditsToUser(payload.userId, payload.quantity)
    //   }
    // }
    // ```
    //
    // =========================================================================

    return ctx.json({})
  })

export type IapCallbackApiType = typeof routes
