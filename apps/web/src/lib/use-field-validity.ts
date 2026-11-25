import * as React from 'react'

/**
 * Remembers which time and date fields of a form hold text that is not a valid value, so the form
 * can refuse to submit instead of saving the last valid value. Pass `onValidityChange` to each
 * `TimeField` / `DateField`; call `blocked()` first thing in the submit handler: it returns true
 * (and moves focus to the first invalid field) while any field is invalid.
 */
export function useFieldValidity() {
  const invalid = React.useRef(new Set<string>())

  const onValidityChange = React.useCallback((isInvalid: boolean, id: string) => {
    if (isInvalid) invalid.current.add(id)
    else invalid.current.delete(id)
  }, [])

  const blocked = React.useCallback((): boolean => {
    for (const id of invalid.current) {
      const el = document.getElementById(id)
      if (el) {
        el.focus()
        return true
      }
      invalid.current.delete(id)
    }
    return false
  }, [])

  return { onValidityChange, blocked }
}
