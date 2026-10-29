// The kit's static guards: the D110 waiter-action guard (rule 7) and the POS-id walk (rule 3).
// Each returns the problems it found, empty when clean, so the kit can also be tested on a
// connector that is wrong on purpose.

import type { ServiceReader } from '../connector'
import { PosRefSchema } from '../pos-ref'
import {
  isWaiterAction,
  SERVICE_READ_STEPS,
  SERVICE_WRITE_STEPS,
  type WaiterActionDeclaration,
} from '../waiter-actions'

const KNOWN_STEPS: ReadonlySet<string> = new Set([
  ...SERVICE_READ_STEPS,
  ...Object.keys(SERVICE_WRITE_STEPS),
])

/**
 * D110's guard. Every export of the connector package's write module is declared, and every
 * declaration names only D110's waiter actions (at least one) and only exports that exist. The
 * connector object offers no operation beyond the interface's steps, so nothing reaches the POS
 * past the seam (no "update a price", no "register a device").
 */
export function waiterActionProblems(
  connector: ServiceReader,
  writeModule: Readonly<Record<string, unknown>>,
  declaration: WaiterActionDeclaration,
): string[] {
  const problems: string[] = []
  for (const name of Object.keys(writeModule)) {
    if (!Object.hasOwn(declaration, name)) {
      problems.push(`the write module exports ${name}, which is not declared as a waiter action`)
    }
  }
  for (const [name, actions] of Object.entries(declaration)) {
    if (!Object.hasOwn(writeModule, name)) {
      problems.push(
        `${name} is declared as a waiter action but the write module has no such export`,
      )
    }
    if (actions.length === 0) problems.push(`${name} is declared with no waiter action`)
    for (const action of actions) {
      if (!isWaiterAction(action)) {
        problems.push(
          `${name} is declared as ${String(action)}, which is not one of D110's waiter actions`,
        )
      }
    }
  }
  for (const name of operationNames(connector)) {
    if (!KNOWN_STEPS.has(name)) {
      problems.push(`the connector offers ${name}, which is not a step of the service interface`)
    }
  }
  return problems
}

/** Every function-valued property of the connector object, own or inherited (not Object's). */
function operationNames(connector: object): string[] {
  const names = new Set<string>()
  for (let proto: object | null = connector; proto && proto !== Object.prototype; ) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor') continue
      if (typeof (connector as Record<string, unknown>)[name] === 'function') names.add(name)
    }
    proto = Object.getPrototypeOf(proto)
  }
  return [...names]
}

/**
 * Rule 3 at the seam: a POS id travels only inside a `PosRef`. Reports every string field of an
 * object that equals the id of a `PosRef` held by that same object (a POS id copied into its
 * name, area or reference, as a fallback label would). A label that only happens to equal the id
 * of some other object (table "10" beside the place whose id is 10) is not a leak.
 */
export function posIdLeaks(value: unknown): string[] {
  const leaks: string[] = []
  walk(value, '$')
  return leaks

  function isRef(node: unknown): node is { pos: string } {
    return PosRefSchema.safeParse(node).success
  }

  /** The ids of the PosRefs among an object's values, one level down (a field or a list of them). */
  function ownIds(node: object): Set<string> {
    const ids = new Set<string>()
    for (const child of Object.values(node)) {
      if (isRef(child)) ids.add(child.pos)
      if (Array.isArray(child)) for (const item of child) if (isRef(item)) ids.add(item.pos)
    }
    return ids
  }

  function walk(node: unknown, path: string): void {
    if (typeof node !== 'object' || node === null || isRef(node)) return
    if (Array.isArray(node)) {
      for (const [index, child] of node.entries()) walk(child, `${path}[${index}]`)
      return
    }
    const ids = ownIds(node)
    for (const [key, child] of Object.entries(node)) {
      if (typeof child === 'string' && ids.has(child)) {
        leaks.push(`${path}.${key} carries the POS id "${child}" outside a PosRef`)
      }
      walk(child, `${path}.${key}`)
    }
  }
}
