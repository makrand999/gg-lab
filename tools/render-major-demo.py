#!/usr/bin/env python3

import json, pathlib, subprocess, textwrap, sys
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'output/major-demo').resolve()
scenes=json.loads((out/'timeline.json').read_text())
def stamp(t,ass=False):
    h=int(t//3600);m=int(t//60)%60;s=int(t)%60
    return f'{h}:{m:02}:{s:02}.{int(t%1*100):02}' if ass else f'{h:02}:{m:02}:{s:02},{int(t%1*1000):03}'
header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1600
PlayResY: 900
WrapStyle: 2
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Title,DejaVu Sans,20,&H00F1CC60,&H00FFFFFF,&H001C140D,&H001C140D,-1,0,0,0,100,100,0,0,1,0,0,7,32,32,0,1
Style: Caption,DejaVu Sans,24,&H00FFFFFF,&H00FFFFFF,&H001C140D,&H001C140D,0,0,0,0,100,100,0,0,1,0,0,7,32,32,0,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
ass=header;srt=[]
for i,s in enumerate(scenes):
    title=s['title'].split(' | ',1)[-1]

    title=('MAJOR | '+title) if i in (0,len(scenes)-1) else f'{i:02} | {title}'
    start=max(0,s['start']);end=s['end']
    caption=r'\N'.join(textwrap.wrap(s['caption'],width=118))
    ass+=f'Dialogue: 0,{stamp(start,True)},{stamp(end,True)},Title,,0,0,0,,{{\\pos(32,808)}}{title}\n'
    ass+=f'Dialogue: 0,{stamp(start,True)},{stamp(end,True)},Caption,,0,0,0,,{{\\pos(32,838)}}{caption}\n'
    srt.append(f'{i+1}\n{stamp(start)} --> {stamp(end)}\n{title}\n{s["caption"]}\n')
(out/'major-captions.ass').write_text(ass)
(out/'major-captions.srt').write_text('\n'.join(srt))
metadata=[';FFMETADATA1','title=Major interface demo','comment=Caption-only walkthrough recorded with local demo data']
for scene in scenes:
    metadata.extend(['[CHAPTER]','TIMEBASE=1/1000','START='+str(round(scene['start']*1000)),'END='+str(round(scene['end']*1000)),'title='+scene['title'].split(' | ',1)[-1]])
(out/'chapters.ffmeta').write_text('\n'.join(metadata)+'\n')
subprocess.run(['ffmpeg','-hide_banner','-loglevel','warning','-y','-i',str(out/'major-raw.webm'),'-i',str(out/'chapters.ffmeta'),'-map_metadata','1','-vf',f"pad=1600:900:0:0:color=0x0d141c,ass={out/'major-captions.ass'},scale=1920:1080",'-r','30','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-an','-movflags','+faststart',str(out/'major-interface-demo.mp4')],check=True)
