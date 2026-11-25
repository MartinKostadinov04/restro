// A click on a toast is not a click outside a modal sheet or dialog (the toaster sits outside
// their content): without this, pressing Undo in a toast closes the sheet the person is working in.
// Radix calls `onInteractOutside` for a pointer press and for focus moving outside; preventing
// its default keeps the modal open.

/** The shape of Radix's outside-interaction event that this needs. */
interface OutsideEvent {
  readonly target: EventTarget | null
  preventDefault(): void
}

/** `onInteractOutside` for a modal: ignores toasts, then calls the caller's own handler. */
export function keepOpenOnToast<E extends OutsideEvent>(
  handler?: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (event.target instanceof Element && event.target.closest('[data-sonner-toaster]')) {
      event.preventDefault()
      return
    }
    handler?.(event)
  }
}
