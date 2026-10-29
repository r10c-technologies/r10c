/**
 * **order-contracts** — the wire contract for `order.placed` and
 * `order.cancelled`.
 *
 * `business:policy`, for the reason `party-contracts` is: `order-management`
 * publishes these events and `settlement-management` folds them, and a
 * `business:domain` package may not depend on another, so the shape both read
 * sits where both can reach it, registered once (ADR 0068).
 */
export * from './values';
