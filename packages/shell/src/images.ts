// R10 Images: the shell picks the asset variant from the face's declared slot (`thumb`, `card`,
// `full`) and the screen's pixel density, passes the focal point through for the crop, and says
// `null` when there is no image so the face can use its declared no-image layout.

import type { AssetId, Locale, MenuSnapshot } from '@restro/core'

import { IMAGE_VARIANTS, type ImageRequest, type ImageVariant } from './context'
import { pickText, type ViewText } from './text'

/** An image as a face draws it. */
export interface ViewImage {
  readonly id: AssetId
  /** The chosen variant file: `/a/<as_ id>/w640.webp`. */
  readonly src: string
  readonly variant: ImageVariant
  /** Pixel width of the chosen file. */
  readonly width: number
  /**
   * Every distinct file the asset has, narrowest first, for a face that lets the browser choose
   * (`srcset` with width descriptors). `src` stays the shell's own pick for the slot and density.
   */
  readonly variants: readonly { readonly src: string; readonly width: number }[]
  /** The original's proportions, for the crop and for reserving space. */
  readonly sourceWidth: number
  readonly sourceHeight: number
  /** Where the crop should stay centred (0–1 on each axis), or null for the middle. */
  readonly focal: { readonly x: number; readonly y: number } | null
  /** `focal` as a CSS `object-position`: "50% 40%". */
  readonly objectPosition: string
  /** The description, or null when neither the asset nor the owner has a text. */
  readonly alt: ViewText | null
}

/**
 * The variant for a slot: the declared one, or the next larger one on a dense screen (2x or
 * more), because the declared variant is sized for one device pixel per CSS pixel.
 */
export function pickVariant(request: ImageRequest): ImageVariant {
  const declared = IMAGE_VARIANTS.indexOf(request.variant)
  const index = Math.min(declared + (request.density >= 2 ? 1 : 0), IMAGE_VARIANTS.length - 1)
  return IMAGE_VARIANTS[index] ?? request.variant
}

/** The pixel width a variant path names (`/a/as_x/w640.webp` is 640), 0 when it names none. */
function fileWidth(src: string): number {
  return Number(/w(\d+)\.webp$/.exec(src)?.[1] ?? 0)
}

/** The asset's files without repeats (a small original has one file for several variants), narrowest first. */
function distinctFiles(variants: Readonly<Record<ImageVariant, string>>): ViewImage['variants'] {
  const files = [...new Set(IMAGE_VARIANTS.map((name) => variants[name]))].map((src) => ({
    src,
    width: fileWidth(src),
  }))
  return files.sort((a, b) => a.width - b.width)
}

/** The image for an asset id, or null when there is none (or the asset is missing). */
export function viewImage(
  assetId: string | null,
  assets: MenuSnapshot['assets'],
  request: ImageRequest,
  chain: readonly Locale[],
  altFallback: ViewText | null,
): ViewImage | null {
  if (assetId === null || !Object.hasOwn(assets, assetId)) return null
  const asset = assets[assetId]
  if (asset === undefined) return null
  const variant = pickVariant(request)
  const src = asset.variants[variant]
  const focal = asset.focal
  const point = focal ?? { x: 0.5, y: 0.5 }
  return {
    id: assetId as AssetId,
    src,
    variant,
    width: fileWidth(src),
    variants: distinctFiles(asset.variants),
    sourceWidth: asset.w,
    sourceHeight: asset.h,
    focal: focal === null ? null : { x: focal.x, y: focal.y },
    objectPosition: `${Math.round(point.x * 100)}% ${Math.round(point.y * 100)}%`,
    alt: pickText(asset.alt, chain) ?? altFallback,
  }
}
