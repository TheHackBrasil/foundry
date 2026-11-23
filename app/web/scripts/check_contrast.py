#!/usr/bin/env python3
"""Mede o contraste WCAG 2.2 dos pares exigidos por RF9 (spec 0006) nos dois temas do app.

Uso: python3 app/web/scripts/check_contrast.py

Lê os tokens declarados em app/web/src/tokens.css (a fonte única dos valores),
mede cada par com o colorlib vendored ao lado e grava o relatório em
app/web/evidencias/contraste-v4.md. Sai com código 1 se algum par exigido
reprovar: a medição é gate local, não documentação posterior.

O script lê tokens.css e reescreve o relatório; não toca mais nada (A3).
"""
import re
import sys
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import colorlib as cl  # noqa: E402

TEXTO, NAO_TEXTO = 4.5, 3.0
TEMAS = {"claro": ":root", "escuro": ":root[data-tema='dark']"}

# (rótulo, frente, fundo, mínimo, onde aparece). Mínimo 0 = informativo, sem exigência.
PARES = [
    ("texto / fundo", "text", "bg", TEXTO, "texto principal"),
    ("texto / superfície", "text", "surface", TEXTO, "texto em botão e cartão"),
    ("texto / superfície 2", "text", "surface2", TEXTO, "texto em faixa"),
    ("texto 2 / fundo", "text2", "bg", TEXTO, "legenda, selo e metadado"),
    ("texto 2 / superfície", "text2", "surface", TEXTO, "legenda em cartão"),
    ("texto 2 / superfície 2", "text2", "surface2", TEXTO, "rótulo de coluna da matriz"),
    ("on-primary / primary", "on-primary", "primary", TEXTO, "botão marcado e link 'pular'"),
    ("primary / superfície", "primary", "surface", NAO_TEXTO, "preenchimento do controle ativo"),
    ("borda forte / superfície", "border-strong", "surface", NAO_TEXTO, "borda de botão, aba e régua da matriz"),
    ("borda forte / fundo", "border-strong", "bg", NAO_TEXTO, "borda de controle sobre o fundo"),
    ("foco / superfície", "focus", "surface", NAO_TEXTO, "anel de foco"),
    ("foco / fundo", "focus", "bg", NAO_TEXTO, "anel de foco sobre o fundo"),
    ("mudança / mudança-bg", "change", "change-bg", TEXTO, "rótulo na célula divergente"),
    ("mudança / fundo", "change", "bg", TEXTO, "'Diverge', 'Nova' e variação"),
    ("mudança / superfície", "change", "surface", TEXTO, "rótulo de divergência em cartão"),
    ("mudança / superfície 2", "change", "surface2", TEXTO, "rótulo na barra do quadro"),
    ("texto / mudança-bg", "text", "change-bg", TEXTO, "valor da célula divergente"),
    ("texto 2 / mudança-bg", "text2", "change-bg", TEXTO, "'antes' riscado sobre a tinta"),
    ("on-rail / rail", "on-rail", "rail", TEXTO, "texto do monólito lateral"),
    ("rail-soft / rail", "rail-soft", "rail", TEXTO, "metadado dentro do monólito"),
    ("ok / ok-bg", "ok", "ok-bg", TEXTO, "chip 'Confere'"),
    ("ok / fundo", "ok", "bg", TEXTO, "'Confere' e 'ao vivo' sobre o fundo"),
    ("warn / warn-bg", "warn", "warn-bg", TEXTO, "estado de atenção"),
    ("warn / fundo", "warn", "bg", TEXTO, "'conectando' sobre o fundo"),
    ("erro / erro-bg", "error", "error-bg", TEXTO, "estado de erro"),
    ("erro / fundo", "error", "bg", TEXTO, "aviso de erro sobre o fundo"),
    ("corda / rail", "cord", "rail", 0, "fio lavanda do monólito (decorativo)"),
    ("petróleo / lavanda", "#163C38", "#D7C5EA", 0, "cordas da marca (informativo)"),
    ("lavanda / papel", "#D7C5EA", "#F5F2EB", 0, "prova de que a lavanda clara não serve de texto"),
]


def ler_tokens():
    css = (WEB / "src" / "tokens.css").read_text(encoding="utf-8")
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    out = {}
    for nome, seletor in TEMAS.items():
        m = re.search(re.escape(seletor) + r"\s*\{(.*?)\}", css, flags=re.S)
        if not m:
            sys.exit(f"bloco {seletor} não encontrado em tokens.css")
        out[nome] = dict(re.findall(r"--([\w-]+):\s*(#[0-9A-Fa-f]{6})", m.group(1)))
    return out


def medir(tokens):
    temas = {}
    for nome, vals in tokens.items():
        linhas = []
        for rotulo, fg, bg, minimo, onde in PARES:
            try:
                frente, fundo = vals.get(fg, fg), vals.get(bg, bg)
                razao = cl.contrast(frente, fundo)
            except Exception as e:  # token ausente ou hex inválido: falha explícita
                sys.exit(f"par '{rotulo}' não medido no tema {nome}: {e}")
            res = "informativo" if minimo == 0 else ("passa" if razao + 1e-9 >= minimo else "REPROVA")
            linhas.append({"par": rotulo, "fg": frente, "bg": fundo, "razao": razao,
                           "min": minimo, "res": res, "onde": onde})
        temas[nome] = linhas
    return temas


def relatorio(temas):
    md = ["# Contraste medido: `app/web` na identidade Brandbook v4", "",
          "Gerado por `app/web/scripts/check_contrast.py` a partir dos valores de",
          "`src/tokens.css` (WCAG 2.2, luminância relativa). Texto exige 4,5:1;",
          "borda de controle e anel de foco, 3:1; pares marcados como informativo",
          "documentam usos gráficos sem exigência de contraste.", ""]
    for nome, linhas in temas.items():
        exigidos = [l for l in linhas if l["res"] != "informativo"]
        passam = [l for l in exigidos if l["res"] == "passa"]
        md.append(f"## Tema {nome}: {len(passam)} de {len(exigidos)} pares exigidos passam")
        md.append("")
        md.append("| par | frente | fundo | razão | mín. | resultado | onde |")
        md.append("|---|---|---|---|---|---|---|")
        for l in linhas:
            minimo = "n/a" if l["min"] == 0 else f'{l["min"]:.1f}'.replace(".", ",")
            razao = f'{l["razao"]:.2f}'.replace(".", ",")
            md.append(f'| {l["par"]} | `{l["fg"]}` | `{l["bg"]}` | {razao} | {minimo} | {l["res"]} | {l["onde"]} |')
        md.append("")
    return "\n".join(md)


def main():
    temas = medir(ler_tokens())
    exigidos = [l for linhas in temas.values() for l in linhas if l["res"] != "informativo"]
    reprovados = [l for l in exigidos if l["res"] == "REPROVA"]
    (WEB / "evidencias" / "contraste-v4.md").write_text(relatorio(temas), encoding="utf-8")
    print(f"pares exigidos: {len(exigidos)}; reprovados: {len(reprovados)}")
    for nome, linhas in temas.items():
        for l in linhas:
            marca = " " if l["res"] == "passa" else ("i" if l["res"] == "informativo" else "X")
            print(f'  [{marca}] {nome:6s} {l["par"]:30s} {l["fg"]} / {l["bg"]}  {l["razao"]:.2f}')
    return 1 if reprovados else 0


if __name__ == "__main__":
    sys.exit(main())
