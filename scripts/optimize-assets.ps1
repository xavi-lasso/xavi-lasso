# Reconstructed from the existing optimized assets (ffprobe / x264 SEI / size-matching),
# not from the original script. Run from the repo root:
#
#   .\scripts\optimize-assets.ps1 -Video research\clip.mp4          # -> research\clip-web.mp4
#   .\scripts\optimize-assets.ps1 -Video hero.mp4 -Crf 25           # lighter, e.g. big horizontal heroes
#   .\scripts\optimize-assets.ps1 -Image thumbs\04-kelly.png        # -> thumbs\04-kelly.webp
#
# Needs ffmpeg + ImageMagick (winget install Gyan.FFmpeg ImageMagick.ImageMagick).
# Originals are left alone; move superseded masters into _old-masters/ (gitignored).
# Cloudflare Pages rejects any single file over 25 MiB.
param(
    [string[]]$Video,
    [string[]]$Image,
    [int]$Crf = 20,         # observed: 20 on most clips, 25 on lounge_vid_hero_horizontal
    [int]$Quality = 90,     # observed: ~90 (re-encoding the PNG masters at q90 matches the shipped sizes)
    [int]$MaxEdge = 2048    # observed: stills top out around 2048 px; a few are larger, so treat as a guideline
)

foreach ($f in $Video) {
    $out = [IO.Path]::ChangeExtension($f, $null).TrimEnd('.') + '-web.mp4'
    # Observed on the shipped -web.mp4 files: H.264 High, yuv420p, `-preset slow` (the x264 options
    # match it exactly), audio stripped, native resolution and frame rate, moov atom up front.
    ffmpeg -y -i $f -an -c:v libx264 -preset slow -crf $Crf -pix_fmt yuv420p -movflags +faststart $out
}

foreach ($f in $Image) {
    $out = [IO.Path]::ChangeExtension($f, 'webp')
    # Lossy WebP; shrink-only resize so small images aren't upscaled.
    magick $f -resize "${MaxEdge}x${MaxEdge}>" -quality $Quality $out
}
