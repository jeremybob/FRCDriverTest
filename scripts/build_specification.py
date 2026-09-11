"""Render the planning specification to a locally generated, linked PDF.

Requires reportlab. Source is docs/product-architecture-implementation.md.
"""
from pathlib import Path
import re
from html import escape

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Preformatted, Flowable,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output/pdf/frc-driver-lab-specification.pdf'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
FONT_DIR = Path('/System/Library/Fonts/Supplemental')
for name, filename in [('Body', 'Arial.ttf'), ('Body-Bold', 'Arial Bold.ttf'),
                       ('Body-Italic', 'Arial Italic.ttf'), ('Mono', 'Andale Mono.ttf')]:
    pdfmetrics.registerFont(TTFont(name, str(FONT_DIR / filename)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='Body-Bold', italic='Body-Italic')

NAVY = colors.HexColor('#102B3A')
TEAL = colors.HexColor('#137E82')
INK = colors.HexColor('#253743')
MUTED = colors.HexColor('#546774')
PALE = colors.HexColor('#EEF4F6')
LINE = colors.HexColor('#D6E0E4')
WIDTH = 504

styles = {
    'body': ParagraphStyle('body', fontName='Body', fontSize=9.6, leading=12.5,
                           textColor=INK, spaceAfter=6),
    'h1': ParagraphStyle('h1', fontName='Body-Bold', fontSize=31, leading=36,
                         textColor=NAVY, spaceBefore=16, spaceAfter=12, keepWithNext=True),
    'h2': ParagraphStyle('h2', fontName='Body-Bold', fontSize=19, leading=23,
                         textColor=NAVY, spaceAfter=10, keepWithNext=True),
    'h3': ParagraphStyle('h3', fontName='Body-Bold', fontSize=11.1, leading=14,
                         textColor=TEAL, spaceBefore=5, spaceAfter=4, keepWithNext=True),
    'cell': ParagraphStyle('cell', fontName='Body', fontSize=8.5, leading=10.8,
                           textColor=INK),
    'th': ParagraphStyle('th', fontName='Body-Bold', fontSize=8.4, leading=11.3,
                         textColor=colors.white),
    'code': ParagraphStyle('code', fontName='Mono', fontSize=8.2, leading=9.5,
                           textColor=INK, backColor=PALE, borderPadding=9,
                           spaceAfter=9),
    'list': ParagraphStyle('list', fontName='Body', fontSize=9.6, leading=12.5,
                           textColor=INK, leftIndent=13, firstLineIndent=-10, spaceAfter=4),
}

def inline(s):
    s = escape(s)
    s = re.sub(r'\[([^\]]+)\]\((https?://[^\s)]+)\)',
               r'<link href="\2" color="#137E82">\1</link>', s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'`([^`]+)`', r'<font name="Mono" size="8.4">\1</font>', s)
    return s

class Architecture(Flowable):
    def __init__(self):
        Flowable.__init__(self)
        self.width, self.height = WIDTH, 192

    def draw(self):
        c = self.canv
        def box(x, y, w, label, sub):
            c.setFillColor(PALE)
            c.setStrokeColor(LINE)
            c.roundRect(x, y, w, 42, 5, fill=1, stroke=1)
            c.setFillColor(NAVY)
            c.setFont('Body-Bold', 9)
            c.drawCentredString(x+w/2, y+26, label)
            c.setFillColor(MUTED)
            c.setFont('Body', 8)
            c.drawCentredString(x+w/2, y+12, sub)
        def arrow(x1,y1,x2,y2):
            c.setStrokeColor(TEAL)
            c.setLineWidth(1.2)
            c.line(x1,y1,x2,y2)
            if x1 == x2:
                c.line(x2,y2,x2-3,y2+5)
                c.line(x2,y2,x2+3,y2+5)
            else:
                c.line(x2,y2,x2-5,y2+3)
                c.line(x2,y2,x2-5,y2-3)
        box(0,142,148,'Input adapters','Gamepad / keyboard / shaping')
        box(177,142,150,'Simulation','Drivetrain forces + Rapier')
        box(356,142,148,'Three.js renderer','Interpolated 3D scene')
        arrow(148,163,177,163)
        arrow(327,163,356,163)
        box(0,75,148,'Test runner','Rules / checkpoints / cues')
        c.setStrokeColor(TEAL)
        c.setLineWidth(1.2)
        c.line(74,117,74,130)
        c.line(74,130,205,130)
        c.line(205,130,205,142)
        c.line(205,142,202,137)
        c.line(205,142,208,137)
        box(177,75,150,'Metrics and scoring','Events -> frozen result')
        box(356,75,148,'React interface','Setup / HUD / review')
        arrow(252,142,252,117)
        arrow(148,96,177,96)
        arrow(327,96,356,96)
        box(177,8,150,'Session and reports','Recovery / PDF / print')
        arrow(252,75,252,50)

def table(rows):
    count = len(rows[0])
    if count == 2:
        ratios = [0.29, 0.71]
        if rows[0][0] == 'Risk': ratios = [0.40, 0.60]
    elif count == 3:
        ratios = [0.20, 0.49, 0.31]
        if rows[0][0] == 'Phase': ratios = [0.21, 0.62, 0.17]
        if rows[0][0] == 'ID': ratios = [0.08, 0.43, 0.49]
        if rows[0][0] == 'Priority': ratios = [0.10, 0.31, 0.59]
        if rows[0][0].startswith('Driver:'): ratios = [0.31, 0.22, 0.47]
    elif count == 4:
        ratios = [0.22, 0.31, 0.32, 0.15]
    else:
        ratios = [1/count]*count
    cells = [[Paragraph(inline(cell), styles['th' if r == 0 else 'cell'])
              for cell in row] for r, row in enumerate(rows)]
    t = Table(cells, colWidths=[WIDTH*x for x in ratios], repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), NAVY),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, PALE]),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 7),
        ('RIGHTPADDING', (0,0), (-1,-1), 7),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LINEBELOW', (0,-1), (-1,-1), 0.5, LINE),
    ]))
    return t

def parse(text):
    lines = text.splitlines()
    story = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line == '<!-- pagebreak -->':
            story.append(PageBreak())
            i += 1
        elif line.startswith('```'):
            code = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                code.append(lines[i])
                i += 1
            i += 1
            story.append(Architecture() if code and code[0].startswith('USB gamepad')
                         else Preformatted('\n'.join(code), styles['code']))
            story.append(Spacer(1,7))
        elif line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                row = [s.strip() for s in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r'[-: ]+', c) for c in row): rows.append(row)
                i += 1
            story += [table(rows), Spacer(1,9)]
        elif line.startswith('#'):
            level = len(line) - len(line.lstrip('#'))
            story.append(Paragraph(inline(line[level:].strip()), styles[f'h{min(level,3)}']))
            i += 1
        elif re.match(r'^(- |\d+\. )',line):
            if line.startswith('- '): line = '\u2022 ' + line[2:]
            story.append(Paragraph(inline(line), styles['list']))
            i += 1
        else:
            para = [line]
            i += 1
            while i < len(lines) and lines[i].strip() and not re.match(r'^(#|\||```|<!--|- |\d+\. )',lines[i]):
                para.append(lines[i].strip())
                i += 1
            story.append(Paragraph(inline(' '.join(para)),styles['body']))
    return story

def page(c, doc):
    c.saveState()
    c.setStrokeColor(TEAL)
    c.setLineWidth(2)
    c.line(54,751,558,751)
    c.setFont('Body-Bold',8)
    c.setFillColor(NAVY)
    c.drawString(54,762,'FRC DRIVER LAB')
    c.setFont('Body',8)
    c.setFillColor(MUTED)
    c.drawRightString(558,762,'PRODUCT + ARCHITECTURE + IMPLEMENTATION')
    c.setStrokeColor(LINE)
    c.setLineWidth(0.5)
    c.line(54,39,558,39)
    c.setFont('Body',7.5)
    c.drawString(54,26,'Planning specification v1.0  |  September 11, 2026')
    c.drawRightString(558,26,str(doc.page))
    c.restoreState()

doc = SimpleDocTemplate(str(OUTPUT), pagesize=(612,792),
                        rightMargin=54,leftMargin=54,topMargin=56,bottomMargin=52,
                        title='FRC Driver Lab - Product, Architecture, and Implementation',
                        author='FRC Driver Lab', subject='Robot driver training and assessment application specification')
doc.build(parse((ROOT/'docs/product-architecture-implementation.md').read_text()),
          onFirstPage=page,onLaterPages=page)
print(OUTPUT)
