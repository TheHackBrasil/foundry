# Fontes e contatos da pesquisa

Onde cada peça da investigação veio. Links e pessoas citados na call de
alinhamento e no Discord do time.

## Campo

- **FENATRAN** — São Paulo Expo, nov/2026. Maior feira de logística da América
  Latina. Origem da maioria das conversas e dos contatos.
- **Lançamento HackBrasil na FIAP Paulista** — 05/11/2026.

## Empresas ouvidas

| Empresa | Contato | O que trouxe |
|---|---|---|
| **TOTVS** ([totvs.com/logistica](https://www.totvs.com/logistica/)) | Especialista logística (WhatsApp) | Dor central: clientes reclamam da gestão de múltiplos parceiros logísticos + cascata financeira. Insight: setor não-letrado — vender solução complexa não funciona. |
| **Schulz / Schulz Tech** ([schulz.com.br](https://www.schulz.com.br/pt_BR)) | Mentor (~6 meses na área logística da empresa de maquinário) | Roteirização é o ativo real; Digital Twin é aditivo visual (feito em ~2 dias). Precisão de minutos = milhões. Usa OR-Tools, não LLM. |
| **Kaufmann** ([kaufmann.com.br](https://www.kaufmann.com.br/)) | Estande FENATRAN | Automação de esteiras para galpões e fábricas. "Reduza despesa ou aumente lucro e qualquer um te ouve." |
| **CAP Logística** (frigorificada, parceria GCCA) | Diretora, via Isabela | Convite a visitar galpões. |
| **Especialista em armazéns** (evento Insper) | Conversa presencial; responde por WhatsApp | 3 gargalos do galpão: recebimento, organização/etiquetagem, expedição. Maior problema: pessoas não seguem processo; RFID/auto-empilhadeira caros demais; caos de etiquetas entre fornecedores; kits explodem NF; peso variável em frios. Avalia que roteirização já tem muita solução no mercado. |
| **Emiteaí** ([emiteai.com.br](https://emiteai.com.br/)) | Estande FENATRAN + conversa solo | Emissão de documentos de rota em ~5 min vs ~30 do mercado. Também tem gestão financeira/operacional (qualidade incerta). Sem blockchain; integração multi-fornecedor incerta. **Referência de comparação.** |
| **Enviagora** ([enviagora.com.br](https://enviagora.com.br/)) | **Rafael Alberto Born, CEO** — via LinkedIn → WhatsApp → secretária | Maior 3PL de e-commerce da América Latina (opera Guday, Dot Energy). Call de descoberta: agendada p/ 18/11 11h30, **remarcada sem nova data**. |

## Contatos pessoais

- **Isabela Claro Sanches** — LinkedIn — primeira resposta; indicou Vivianne;
  ponte para visita a galpões (GCCA).
- **Vivianne Moreira Leite** — LinkedIn — especialista em armazéns (conversa
  acima).
- **Patrick** — amigo do time; mentor neste hackathon (projeto Renner, memória
  para agents).
- **Liz** — 4ª integrante pendente de confirmação.

## Referências técnicas e de mercado

- **OR-Tools** ([developers.google.com/optimization](https://developers.google.com/optimization?hl=pt-br))
  — otimização determinística de rotas (citada pelo mentor Schulz).
- **Physical Internet / XaaS** — paradigma de virtualizar ativos físicos sob
  demanda ("AWS da capacidade física"); ver `dossie-physical-capacity-orchestrator.pdf`.
- **Thermo King** — refrigeração de carga vista na FENATRAN; referência de
  hardware da cadeia fria.
- **Operações reais de fulfillment**: vídeo "Como funciona uma operação de
  FULFILLMENT por dentro" (Matteo Couto, YouTube) — operação da Enviagora;
  Guday (gummies) e Dot Energy (energético em bala) como cases de clientes.
- Termo aprendido em campo: **"cavalo"** = cavalo mecânico (caminhão sem
  carreta); carreta é fornecida por outro player — troca de semi-reboques é
  rotina da operação.

## Artefatos desta pasta

- `resumo-call-2026-11-16.md` — resumo executivo da call de alinhamento.
- `transcricao-call-2026-11-16.txt` — transcrição integral revisada (versão
  compartilhável, com corte editorial no final).
- `resumo-call-2026-11-16.docx` — documento original do resumo.
- `dossie-physical-capacity-orchestrator.pdf` — blueprint da visão macro
  (orquestração de capacidade + blockchain B2B). **Visão de arco, não escopo
  de MVP.**
- `escopo.md` — decisões tomadas, perguntas abertas e riscos.
