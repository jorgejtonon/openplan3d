"""Builds the new-drawing templates (cad/public/templates/novo-{mm,cm,m}.dxf).

Run with: python3 cad/tools/make-templates.py   (needs ezdxf)
The dimension scale and linetype scale are set by the app for the chosen plot scale.
"""
import pathlib
import ezdxf

OUT = pathlib.Path(__file__).resolve().parent.parent / 'public' / 'templates'

# name, ACI colour, linetype, lineweight (1/100 mm), plotted, description
LAYERS = [
    ('EIXOS', 1, 'CENTER', 13, True, 'Eixos e linhas de centro'),
    ('PAREDES', 7, 'Continuous', 40, True, 'Paredes, muros e estruturas em corte'),
    ('ESQUADRIAS', 4, 'Continuous', 18, True, 'Portas, janelas e aberturas'),
    ('ESTRUTURA', 140, 'Continuous', 35, True, 'Pilares, vigas e lajes'),
    ('COTAS', 3, 'Continuous', 13, True, 'Cotas e linhas de chamada'),
    ('TEXTOS', 2, 'Continuous', 18, True, 'Textos, legendas e notas'),
    ('HACHURAS', 8, 'Continuous', 9, True, 'Hachuras e preenchimentos'),
    ('MOBILIARIO', 6, 'Continuous', 13, True, 'Mobiliário e equipamentos'),
    ('PROJECAO', 9, 'HIDDEN', 13, True, 'Projeções e elementos acima do corte'),
    ('REDE-AGUA', 5, 'Continuous', 35, True, 'Rede de água'),
    ('REDE-ESGOTO', 30, 'Continuous', 35, True, 'Rede coletora de esgoto'),
    ('DRENAGEM', 150, 'DASHED', 35, True, 'Drenagem pluvial'),
    ('TOPOGRAFIA', 52, 'Continuous', 9, True, 'Curvas de nível e pontos levantados'),
    ('CARIMBO', 7, 'Continuous', 25, True, 'Moldura e carimbo'),
    ('AUXILIAR', 211, 'DASHED', 9, False, 'Linhas de construção (não imprime)'),
]

UNITS = {'mm': (4, 0), 'cm': (5, 1), 'm': (6, 2)}

for unit, (insunits, decimals) in UNITS.items():
    doc = ezdxf.new('R2010', setup=True, units=insunits)
    doc.header['$MEASUREMENT'] = 1
    doc.header['$LUNITS'] = 2
    doc.header['$LUPREC'] = decimals
    doc.header['$AUNITS'] = 0
    doc.header['$AUPREC'] = 0
    doc.header['$DIMDSEP'] = 44  # decimal comma
    for name, colour, linetype, weight, plot, description in LAYERS:
        layer = doc.layers.add(name, color=colour, linetype=linetype, lineweight=weight)
        layer.dxf.plot = 1 if plot else 0
        layer.description = description
    style = doc.dimstyles.get('Standard')
    for key, value in {
        'dimtxt': 2.5, 'dimasz': 2.0, 'dimexe': 1.25, 'dimexo': 1.0, 'dimgap': 0.8, 'dimdec': decimals,
        'dimdsep': 44, 'dimtad': 1, 'dimtih': 0, 'dimtoh': 0, 'dimblk': 'ARCHTICK', 'dimlunit': 2, 'dimzin': 8,
        'dimclrd': 3, 'dimclre': 3, 'dimclrt': 2, 'dimscale': 1.0,
    }.items():
        try:
            style.set_dxf_attrib(key, value)
        except Exception as error:  # attribute not available in this ezdxf version
            print('skip', key, error)
    doc.header['$DIMSTYLE'] = 'Standard'
    doc.header['$CLAYER'] = '0'
    doc.saveas(OUT / f'novo-{unit}.dxf')
    print('wrote', OUT / f'novo-{unit}.dxf')
