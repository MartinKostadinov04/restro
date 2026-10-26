// The part of `web-push` (3.6) the worker uses. The package ships no types, and a types package
// would be a second dependency the ticket does not name, so the shape is written here.
declare module 'web-push' {
  const webpush: {
    sendNotification(
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
      payload: string,
      options: Record<string, unknown>,
    ): Promise<{ statusCode: number }>
  }
  export default webpush
}
