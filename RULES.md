# RULES: HackBrasil 2026 (restrições conhecidas + consequências)

Só entra aqui restrição **verificada** (documento oficial, anúncio ou registro
do time). Lacunas ficam como pendência em `DECISIONS.md` (P-NNN): nunca
inventar regra.

Fonte oficial: [hackbrasil.com/regulamento](https://hackbrasil.com/regulamento)
(última atualização 18/11/2026, lida em 20/11). Em conflito com FAQ ou outra
comunicação, vale o regulamento (item 1.6). A página
`hackbrazil.gitbook.io` é de outro evento (HackBrazil 2020) e não se aplica.

## Fatos confirmados

- **Trilha:** Logística & automação (item 5.2).
- **Submissão:** até 30/11/2026, 23h59, no painel do time. O júri avalia o
  repositório no estado do último commit até esse horário (7.1).
- **Entregáveis exigidos (7.2):** nome, frase e descrição do projeto; trilha;
  link de cada repositório público no GitHub; link da demo funcionando;
  vídeo de até 3 minutos, acessível sem login, que mostre o produto
  funcionando. O site do diário não consta da lista.
- **Avaliação online:** a demo deve continuar no ar durante a avaliação; fora
  do ar, o júri avalia só vídeo e código (7.3). Os jurados não são obrigados
  a instalar nem executar o projeto (7.4).
- **Critérios (9.1), mesmo peso, nota de 0 a 10 cada, total 0 a 40 (9.2):**
  execução técnica (se o produto funciona e está completo); implementação
  técnica (arquitetura, qualidade do código, escolha e uso das tecnologias,
  APIs e ferramentas); impacto do projeto (efeito sobre o problema e o
  público da trilha); qualidade da comunicação do projeto (vídeo na fase
  online, apresentação ao júri na final). O FAQ diz "apresentação"; vale
  "comunicação".
- **Finalistas:** os 5 melhores de cada trilha com nota mínima de 20/40,
  anunciados em 02/12; confirmação de presença até 04/12 (8.1, 8.2, 9.4).
- **Desempate:** maior nota em execução técnica, depois em impacto (9.5).
- **Congelamento:** de 30/11, 23h59, até a final, nenhum commit nos
  repositórios entregues; commit no período pode desclassificar (8.4).
- **Final:** presencial em São Paulo, 12/12. Os times terminam o projeto no
  local e apresentam ao júri; notas recomeçam do zero (8.3, 9.3). Todo o
  time precisa estar presente (8.5); viagem e estadia por conta própria (8.6).
- **Time:** de 1 a 4 integrantes (4.1). Atual: Gabriel Sacilotto, Guilherme
  Barreto, Thiago. A Liz saiu do time (informado em 20/11).
- **Código:** repositórios criados depois de 04/11, 21h, sem fork nem
  histórico importado; todo código do evento precisa estar nos repositórios
  entregues; código anterior só se já era público, copiado em commit que
  cite a origem (6.1, 6.2). Repositórios públicos até pelo menos 15/12 (6.7).
- **Ferramentas:** nenhuma ferramenta de patrocinador é exigida nem dá ponto
  extra; tecnologias contam só dentro da implementação técnica (6.3). IA é
  permitida e recomendada (6.4).
- **Dados:** demos não podem expor dados pessoais reais de terceiros (6.9).
- **Prêmios:** classificação geral da final, entre todas as trilhas (10.1).
- **Concorrência:** 200+ grupos já enviaram pitch (mencionado na call;
  fonte interna, não oficial).

## Pendente verificar (oficial)

- Formato, horários e duração da apresentação na final: enviados aos
  finalistas por e-mail (8.3).
- Nomes e perfil dos jurados: anunciados até 30/11 (9.4).

## Consequências operacionais

1. **10 dias de calendário e um gate de classificação** → até 30/11 o alvo
   é um fluxo estreito, completo e no ar; o que impressiona ao vivo fica
   para 12/12 (ver `docs/plano-mvp.pdf`).
2. **Demo e vídeo do produto são obrigatórios** → deploy cedo, demo estável
   por duas semanas sem mudança de código, vídeo gravado do produto real.
3. **Repo é entregável auditável** → histórico limpo, decisões datadas
   (`DECISIONS.md`), nada de claim sem fonte (A7 da constituição).
4. **O site não é avaliado** → o diário continua como registro do processo,
   mas não disputa tempo com produto e vídeo.
5. Deadline impede promessa de implantação real → honestidade registrada
   na call é regra de comunicação (não prometer piloto antes de 30/11).
