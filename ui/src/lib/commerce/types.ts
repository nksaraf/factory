export interface Customer {
  id: string
  slug: string
  name: string
  spec: {
    type: string
    status: string
    billingEmail?: string
    companyName?: string
    stripeId?: string
    website?: string
    address?: {
      line1?: string
      line2?: string
      city?: string
      state?: string
      postalCode?: string
      country?: string
    }
  }
  createdAt: string
  updatedAt: string
}

export interface Plan {
  id: string
  slug: string
  name: string
  type: string
  spec: {
    description?: string
    price: number
    billingInterval: string
    currency: string
    includedCapabilities: string[]
    trialDays: number
    isPublic: boolean
    stripePriceId?: string
  }
  createdAt: string
  updatedAt: string
}

export interface Subscription {
  id: string
  customerId: string
  planId: string
  spec: {
    status: string
    currentPeriodStart: string
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
    trialEndsAt?: string
    stripeSubscriptionId?: string
    cancelledAt?: string
    cancelReason?: string
  }
  createdAt: string
  updatedAt: string
}

export interface SubscriptionItem {
  id: string
  subscriptionId: string
  capabilityId: string | null
  spec: {
    status: string
    quantity: number
    usageLimit?: number
    overagePolicy: string
    currentUsage: number
    lastResetAt?: string
  }
  createdAt: string
  updatedAt: string
}

export interface EntitlementBundle {
  id: string
  customerId: string
  spec: {
    signedPayload: string
    signature: string
    issuer: string
    bundleVersion: number
    expiresAt: string
    capabilities: string[]
    maxSites?: number
  }
  createdAt: string
  updatedAt: string
}

export interface Tenant {
  id: string
  slug: string
  name: string
  siteId: string
  customerId: string
  spec: {
    isolation?: string
  }
  createdAt: string
  updatedAt: string
}

export interface BillableMetric {
  id: string
  slug: string
  name: string
  capabilityId: string | null
  spec: {
    aggregation: string
    eventName: string
    property?: string
    resetInterval: string
    unit?: string
    description?: string
  }
  createdAt: string
  updatedAt: string
}
