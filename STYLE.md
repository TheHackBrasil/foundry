# STYLE: guia de prosa antislop (pt-BR)

Como se escreve neste repo. Aplica a `docs/`, `specs/`, `DECISIONS.md`,
`RULES.md`, `BACKLOG.md`, `README.md` e à copy do site. Complementa A6
(idioma), o guard verifica o que dá pra verificar mecanicamente; o resto
é revisão.

## Antes de escrever

- **Invocar as skills de prosa quando disponíveis no harness:**
  `humanizer` para prosa/documentos, `antislop-copywriting` para copy do
  site e pitch, `better-writing` para strings de interface (botões,
  erros, labels). Sem a skill instalada, aplicar este guia à mão.
- O tom é direto e sóbrio, de documento lido por banca e parceiros: sem
  coloquialismos na voz do texto. A transcrição e o Discord são fonte de
  fatos e decisões, não de registro.

## Proibido: sinais de texto gerado

- **Travessão (U+2014) como pontuação.** O guard falha em qualquer
  travessão em `.md`. Para aposto ou explicação: dois-pontos, vírgula,
  parênteses ou ponto. En-dash de intervalo (15–20) segue valendo.
- Conectivos automáticos: "no entanto", "contudo", "além disso",
  "ademais": preferir "mas", "e", "também" ou nada.
- Infladores: "é importante notar/ressaltar/destacar", "vale mencionar",
  "é crucial/essencial/vital", "papel fundamental", "cada vez mais",
  "no mundo de hoje", "cenário atual".
- Fórmulas: "não apenas X, mas Y", "não é X, é Y", tríades de adjetivos
  ("claro, conciso e completo"), perguntas retóricas como gancho.
- Verbetes de marketing: "robusto", "seamless", "jornada", "empoderar",
  "desbloquear", "elevar", "impulsionar", "transformar", "revolucionar",
  "imersivo", "holístico". Superlativo só com número e fonte.
- Burocratês: "utilizar" (usar), "realizar" (fazer), "de forma a" (para),
  "visando" (para), "tendo em vista" (para/com), "por meio de" (por/com).
- Fechos de relatório escolar: "Em resumo", "Concluindo", "Em conclusão",
  "Primeiramente… Em seguida… Por fim".
- Emoji e Unicode como ícone em prosa; negrito em excesso; parágrafos
  todos do mesmo tamanho; bullet onde duas frases bastam.
- "Certamente", "Absolutamente", "Com certeza" como abertura.

## Preferido: como soa natural

- Voz ativa, sujeito cedo, frases de tamanho variado.
- Primeira pessoa do time quando verdade: "conversamos na FENATRAN",
  "a gente achou que X, e era Y".
- Número com fonte e sem adjetivo: "RMSE 1.699" em vez de "performance
  impressionante de 1.699".
- Ponto final como pontuação padrão. Dois-pontos para explicação.
  Parênteses para aposto discreto.
- Termo técnico em inglês quando o pt-BR não é o usado na prática
  (commit, deploy, backlog); natural quando é (validação, entrega).
- Hipótese rotulada como hipótese. O que não se sabe fica como pergunta
  aberta, não como certeza disfarçada.

## O que NÃO marcar (falsos positivos)

Antislop é tirar padrão, não tirar voz. Passam direto:

- Citação fiel e transcrição de fala podem conter coloquialismo ("a
  gente", "morre na gaveta"): é a voz da fonte. Na voz do documento, não.
- Frase curta depois de frase longa, ritmo irregular, parágrafo
  imperfeito: é o que diferencia texto de pessoa de texto de modelo.
- Termo coloquial do domínio ("cavalo" = cavalo mecânico, "achismo").
- Travessão em citação fiel de terceiro ou fala direta: nesses casos
  prefira «aspas» ou transcrição entre aspas; se ainda assim o travessão
  for necessário, o trecho vai para arquivo protegido (A9), que o check
  `prose` ignora.
- Doc curto sem floreio: a ausência de enfeite não é defeito.

## Checklist antes de publicar prosa

1. Skill `humanizer` (ou `antislop-copywriting` para copy) rodada ou
   guia aplicado à mão.
2. `node scripts/repo-guard.mjs` verde: inclui o check `prose`.
3. Releitura caçando: conectivo automático, inflador, tríade, frase que
   soaria estranha falada em voz alta.
