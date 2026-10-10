// A QR code as a picture (brief S3-07). The SVG comes from the server (`qrcode`: black on white,
// error correction M, a quiet zone of 2 modules) and is drawn as an `<img>`, so no markup is ever
// put into the page. The white is part of the picture: a code stays scannable on a dark page.
import { svgDataUri } from './svg-uri'

export function QrPicture({
  svg,
  alt,
  className,
  testId = 'qr-picture',
}: {
  svg: string
  alt: string
  className?: string
  testId?: string
}) {
  return (
    // biome-ignore lint/performance/noImgElement: an inline data picture, not a static asset
    <img
      src={svgDataUri(svg)}
      alt={alt}
      className={className}
      data-testid={testId}
      draggable={false}
    />
  )
}
