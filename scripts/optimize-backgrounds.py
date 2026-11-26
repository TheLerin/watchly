"""Re-encode the existing full loops, with no cuts or audio. Requires FFmpeg."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def ffmpeg_path():
    candidate = os.environ.get('FFMPEG_PATH') or shutil.which('ffmpeg')
    if candidate:
        return candidate
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise SystemExit('Install FFmpeg or set FFMPEG_PATH.')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--webm', action='store_true', help='Encode efficient VP9 alternatives from retained originals')
    args = parser.parse_args()
    ffmpeg = ffmpeg_path()
    scratch = ROOT / '.codex-runtime' / 'media-optimization'
    scratch.mkdir(parents=True, exist_ok=True)
    results = []
    for name, width, bitrate, target in [('bg-video.mp4', 960, 390, 5_000_000), ('bg-video-mobile.mp4', 640, 155, 2_000_000)]:
        dest = ROOT / 'frontend' / 'public' / name
        original = scratch / ('original-' + name)
        if not original.exists():
            shutil.copy2(dest, original)
        if args.webm:
            dest = dest.with_suffix('.webm')
        if dest.exists() and dest.stat().st_size < target and not args.force:
            print(f'{name}: already optimized ({dest.stat().st_size:,} bytes)')
            continue
        output = scratch / dest.name
        common = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(original), '-map', '0:v:0', '-an',
                  '-vf', f'scale={width}:-2:flags=lanczos,fps=30', '-c:v', 'libx264', '-preset', 'slow',
                  '-b:v', f'{bitrate}k', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', '60',
                  '-passlogfile', str(scratch / name)]
        if args.webm:
            common = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-i', str(original), '-map', '0:v:0', '-an',
                      '-vf', f'scale={width}:-2:flags=lanczos,fps=30', '-c:v', 'libvpx-vp9', '-b:v', f'{bitrate}k',
                      '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-pix_fmt', 'yuv420p', '-g', '60',
                      '-passlogfile', str(scratch / (name + '-vp9'))]
        subprocess.run(common + ['-pass', '1', '-f', 'null', os.devnull], check=True)
        subprocess.run(common + ['-pass', '2'] + ([] if args.webm else ['-movflags', '+faststart']) + [str(output)], check=True)
        if output.stat().st_size >= 25 * 1024 * 1024:
            raise SystemExit(f'{name} exceeds the platform limit.')
        # Compare decoded pictures at the output resolution. SSIM is a diagnostic, not a visual review.
        comparison = subprocess.run([ffmpeg, '-hide_banner', '-i', str(original), '-i', str(output), '-lavfi',
            f'[0:v]scale={width}:-2:flags=lanczos,fps=30,setsar=1[a];[1:v]setsar=1[b];[a][b]ssim', '-an', '-f', 'null', os.devnull], capture_output=True, text=True)
        ssim = re.search(r'All:([\d.]+)', comparison.stderr)
        shutil.copy2(output, dest)
        poster = ROOT / 'frontend' / 'public' / ('bg-video-mobile-poster.jpg' if 'mobile' in name else 'bg-video-poster.jpg')
        subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-ss', '12', '-i', str(dest), '-frames:v', '1', '-q:v', '3', str(poster)], check=True)
        result = {'file': dest.name, 'originalBytes': original.stat().st_size, 'optimizedBytes': dest.stat().st_size,
                  'width': width, 'fps': 30, 'audio': False, 'ssimAtOutputResolution': float(ssim[1]) if ssim else None}
        results.append(result)
        print(json.dumps(result), flush=True)
    if results:
        (ROOT / 'docs' / ('background-webm-optimization.json' if args.webm else 'background-optimization.json')).write_text(json.dumps(results, indent=2) + '\n')

if __name__ == '__main__':
    main()
