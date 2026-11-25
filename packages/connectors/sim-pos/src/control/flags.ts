// Command-line flags of the simulator's CLI (#71), apart from the CLI so a test can import them.

/** `--name value` pairs; a repeated name joins its values with commas. */
export function parseFlags(args: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === undefined || !flag.startsWith('--') || flag.length < 3) {
      throw new Error(`unexpected "${flag ?? ''}": arguments are --name value`)
    }
    const name = flag.slice(2)
    const value = args[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`)
    flags[name] = name in flags ? `${flags[name]},${value}` : value
    index += 1
  }
  return flags
}
