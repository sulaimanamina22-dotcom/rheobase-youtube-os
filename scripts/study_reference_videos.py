"""Extract timestamped private reference samples; never modify source media."""
from pathlib import Path
import av, json, math, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/2026-09-05-reference-study'
if len(sys.argv) > 1 and sys.argv[1] == 'ozone':
    OUT = ROOT / 'outputs/2026-09-06-ozone-reference-study'
OUT.mkdir(parents=True, exist_ok=True)
DOWNLOADS = Path('C:/Users/HP/Downloads')
SOURCES = {
    'digging': DOWNLOADS / 'What If You Just Keep Digging - Cleo Abram (1080p, h264).mp4',
    'nuclear': DOWNLOADS / 'The Big Lie About Nuclear Waste - Cleo Abram (1080p, h264).mp4',
    'ozone': Path('C:/Users/HP/Videos/Something’s Happening to the Ozone Hole - Cleo Abram (1080p, h264).mp4'),
}
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 18)

def samples(key, times, label):
    path = SOURCES[key]
    rows = []
    images = []
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        stream.thread_type = 'AUTO'
        duration = float(container.duration / av.time_base)
        for target in times:
            if target >= duration:
                continue
            container.seek(int(target / stream.time_base), stream=stream, backward=True)
            for frame in container.decode(stream):
                if frame.time is not None and frame.time >= target:
                    im = frame.to_image().convert('RGB')
                    im.thumbnail((384, 216))
                    images.append(im)
                    rows.append({'requested_s':target, 'decoded_s':frame.time})
                    break
        meta = {'source':str(path),'bytes':path.stat().st_size,'duration_s':duration,
                'width':stream.width,'height':stream.height,'fps':str(stream.average_rate),
                'scope':'Timestamp samples only, not continuous playback or listening', 'samples':rows}
    for start in range(0, len(images), 20):
        batch = images[start:start+20]
        sheet = Image.new('RGB', (1536, math.ceil(len(batch)/4)*246), '#161616')
        draw = ImageDraw.Draw(sheet)
        for j, im in enumerate(batch):
            x,y = (j%4)*384, (j//4)*246
            sheet.paste(im,(x,y))
            t = rows[start+j]['decoded_s']
            draw.text((x+8,y+220), f'{int(t)//60:02}:{t%60:05.2f}',font=font,fill='white')
        sheet.save(OUT/f'{key}-{label}-{start//20+1}.jpg',quality=91)
    (OUT/f'{key}-{label}.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    print(key,label,len(images),round(duration,3),flush=True)

if len(sys.argv)>1:
    if sys.argv[2] == 'overview' and len(sys.argv) == 3:
        with av.open(str(SOURCES[sys.argv[1]])) as container:
            duration = container.duration / av.time_base
        samples(sys.argv[1], range(0, math.ceil(duration), 20), 'overview')
    else:
        samples(sys.argv[1], [float(t) for t in sys.argv[3:]], sys.argv[2])
else:
    for key in ('digging', 'nuclear'):
        path = SOURCES[key]
        with av.open(str(path)) as container:
            duration = container.duration / av.time_base
        samples(key,range(0,math.ceil(duration),20),'overview')
    samples('digging',range(70,121,3),'descent')
    samples('digging',range(294,347,2),'evidence')
