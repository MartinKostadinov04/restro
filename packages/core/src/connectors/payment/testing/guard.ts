// The suite's static guard: the provider object offers the interface's steps and nothing else,
// so no refund but the one step `refundLine` (the 11-18 refund decision, 148) and no other money
// path reaches the provider past the seam.
// Returns the problems it found, empty when clean.

import { PAYMENT_PROVIDER_STEPS } from '../provider'

const STEPS: ReadonlySet<string> = new Set(PAYMENT_PROVIDER_STEPS)

export function providerOperationProblems(provider: object): string[] {
  const problems: string[] = []
  const offered = operationNames(provider)
  for (const name of offered) {
    if (!STEPS.has(name)) {
      problems.push(`the provider offers ${name}, which is not a step of the payment interface`)
    }
  }
  for (const step of PAYMENT_PROVIDER_STEPS) {
    if (!offered.includes(step)) problems.push(`the provider lacks the step ${step}`)
  }
  return problems
}

/** Every function-valued property of the object, own or inherited (not Object's). */
function operationNames(target: object): string[] {
  const names = new Set<string>()
  for (let proto: object | null = target; proto && proto !== Object.prototype; ) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue
      if (typeof (target as Record<string, unknown>)[name] === 'function') names.add(name)
    }
    proto = Object.getPrototypeOf(proto)
  }
  return [...names]
}
