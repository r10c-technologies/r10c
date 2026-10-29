type EsErrors = typeof import('../es/errors').errors;

export const errors: EsErrors = {
  unauthenticated: 'Your session is not valid. Sign in again.',
  forbidden: 'You do not have permission to do this.',
  sessionExpired: 'Your session has expired.',
  sessionUnresolved: 'The session could not be resolved.',
  invalidCredentials: 'Invalid credentials.',
  invalidState: 'That sign-in link has expired. Try again.',
  accountInactive: 'Your account is suspended.',
  providerUnavailable: 'We could not reach the identity provider.',
  upstreamUnavailable:
    'That service is not answering right now. Try again in a moment.',
  signInFailed: 'Sign-in could not be completed.',
  noActiveOrganization: 'Select an organization to continue.',
  invalidRequest: 'The request is not valid.',
  paymentDeclined: 'The payment could not be processed. Try another method.',
  refundDeclined: 'The refund could not be processed. Contact support.',
  noCapturedPayment:
    'No payment was taken for this order, so nothing can be sent back.',
  // A vendor asking to cancel a basket that also names somebody else. Partial
  // cancellation of a multi-vendor order is out of scope by decision rather than
  // by omission — the money was taken once, for the whole basket, on one capture
  // (ADR 0058 §1) — so the message says who can do it instead of implying a
  // retry would work.
  multiVendorOrder:
    'This order also covers another vendor, so only an operator can cancel it.',
  orderNotFulfillable:
    'This order can no longer be marked as delivered. It may have been cancelled.',
  orderNotCancellable:
    'This order can no longer be cancelled. It may already be on its way, or a cancellation may be in progress.',
  categoryParentMissing: 'The parent category does not exist.',
  categoryParentRetired:
    'The parent category is retired. Restore it first, or choose another parent.',
  categoryCycle:
    'A category cannot sit under itself or under one of its own subcategories.',
  categoryTooDeep: 'Categories can be at most five levels deep.',
  categoryHasChildren:
    'This category still has active subcategories. Retire or move them first.',
  categoryTreeUnreadable:
    'The category tree could not be checked right now. Try again in a moment.',
  mediaNotHttps: 'Every image URL must be a full https:// address.',
  mediaAltMissing: 'Every image needs a description.',
  paymentPending:
    'Your payment is still being confirmed. Try again in a moment.',
  // Every refusal of the buyer's own cancel capability answers with this one
  // code. The three-way distinction order-service draws — no capability, a bad
  // one, a closed window — is for the log: telling an unauthenticated caller
  // which of the three they hit is telling them how to get closer.
  cancelNotAuthorized:
    'This order cannot be cancelled from here. The cancellation window may have closed.',
  invalidBody: 'The request body is not valid.',
  invalidQuery: 'The query is not valid.',
  invalidCommand: 'The command is not valid.',
  notFound: 'The record was not found.',
  alreadyRetired: 'It was already retired.',
  // The one genuinely illegal move in an offering's lifecycle: taking down
  // something that was never published. Refused in the domain, not the route.
  illegalOfferingTransition: 'The offering cannot move to that state.',
  // The published record carries an amount and a currency, so there is nothing
  // to project without one. Refused at the verb, where the vendor can fix it.
  offeringHasNoPrice: 'Add a price before publishing this offering.',
  offeringHasNoSpecification:
    'This offering points at a specification that no longer exists.',
  // Two changes raced on one offering and the other landed first; the vendor
  // reloads and acts on what is there now (#371).
  offeringChanged:
    'This offering changed while you were working. Reload it and try again.',
  // A movement's quantity is signed, so a well-formed document can still
  // contradict its reason: a receipt of -50 says goods arrived and took stock
  // away. Refused in the domain.
  inconsistentMovement: 'The quantity does not match the movement reason.',
  // What is left to promise is `onHand - reserved`, and a hold is taken by an
  // atomic write conditioned on it. Zero documents matched *is* the out-of-stock
  // answer, not a system error.
  insufficientStock: 'There is not enough stock to reserve.',
  channelInactive: 'That sales channel is retired.',
  notYours: 'That offering belongs to another vendor.',
  resourceBusy: 'The resource is busy, try again.',
  identifierRequired: 'An account needs at least one identifier.',
  emailRequired: 'An email identifier is required.',
  roleNotAllowed: 'You are not allowed to assign that role.',
  userNotFound: 'The user was not found.',
  userNotAllowed: 'You are not allowed to modify that user.',
  selfRoleChange: 'You cannot change your own role or status.',
  nothingToUpdate: 'There is nothing to update.',
  unknownRole: 'Unknown role.',
  unknownStatus: 'Unknown status.',
  configUnavailable: 'The configuration could not be loaded.',
  secretRequiresValue: 'To stop marking a value as secret, enter a new one.',
  network: 'Network error. Check that the service is reachable.',
  timeout: 'The service took too long to respond.',
  unexpected: 'Something went wrong.',
  // The failures entifix and the fleet register (ADR 0064): a code is the
  // failure's own, permanent, and the gate reads the registry for it.
  stockUnavailable: 'The sale could not be completed. Check the stock on hand.',
  unavailable: 'A service is unavailable right now. Try again in a moment.',
  invalid: 'Some of the data is not valid. Check the form.',
  invalidEnvelope: 'The request body is not valid.',
  invalidRecords: 'Some records are not valid.',
  duplicateKey: 'A record with that value already exists.',
  declined: 'The request was declined.',
  contention: 'Another operation got there first. Try again.',
  overloaded: 'The service is overloaded. Try again in a moment.',
  protocol: 'A service answered something that could not be read.',
  internal: 'Something failed on our side. It has been logged.',
  idempotencyKeyMissing: 'The request is missing its idempotency key.',
  idempotencyKeyReused:
    'That idempotency key was already used for another request.',
  idempotencyKeyInFlight: 'That request is still being processed.',
  flowNotComposable: 'That operation cannot be put together for this request.',
  variantUnavailable: 'That operation is not available to you.',
  flowNotFound: 'That operation could not be found.',
  flowSignalRejected: 'That operation is not waiting for this step.',
  invalidToken: 'Your session is not valid. Sign in again.',
  expiredToken: 'Your session has expired. Sign in again.',
};
