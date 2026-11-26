// What the web app checks once, when the server starts, before it answers any request (Next.js's
// `register`, which `next build` never calls). A setting read per request by the proxy is checked
// here too, so a bad value stops the app at start-up instead of failing every page it touches.
import { bookingFrameAncestors } from '@/server/env'

export function register(): void {
  // The sites that may frame the booking page (#581, D178): throws, naming the variable and never
  // its value, when it is not up to three origins.
  bookingFrameAncestors()
}
