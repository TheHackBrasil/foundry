# Brief polish-vistas: persistencia e sistema de vistas

Frente: polish-vistas (worktree wt/polish-vistas, branch wt/polish-vistas)
Spec: specs/0015-polimento-torre/spec.md

## Paths que voce pode escrever (o hook bloqueia qualquer outro)

- app/web/src/components/torre/layout.ts
- app/web/src/components/torre/layout.test.ts
- app/web/src/components/torre/TorreVistas.tsx
- specs/0015-polimento-torre/brief-vistas.md

Proibido: TorreGrid.tsx, TorreCard.tsx, torre-v2.css, App.tsx, styles.css,
servidor. Skills obrigatorias antes de implementar: ux-heuristics e
better-accessibility (estao em ~/.agents/skills/). Declare no relatorio
final quais usou.

## Contexto

A Torre tem vistas (presets Operação/Atrasos/Fiscal/Financeiro/Despacho mais
custom salvaveis), densidade global ciclica e layout persistido por pedido
em localStorage. Auditoria de usabilidade encontrou bug critico de
assinatura, controle de densidade mentiroso, zero undo/reset e colisao de
nomes com as abas de lente.

## Escopo (ordem de prioridade)

### V1. Bug critico: presets nunca mais ativam apos span customizado

Verificado pela integracao: `templateCorrespondente` compara a assinatura do
layout atual (com spans do usuario) contra a assinatura do template (sem
spans, porque presets nao declaram spans e `aplicarTemplate` preserva os do
usuario). Um clique na pill de largura e nenhum preset volta a ativar.
Desvio da spec 0014 (D-T5: chip ativo detectado por ordem+ocultos).

Corrigir: templates que nao declaram spans comparam apenas ordem+ocultos.
Templates custom que declaram spans podem comparar spans tambem (implementador
decide e justifica; o importante e que presets built-in ativem). Testes de
regressao obrigatorios em layout.test.ts: preset ativa com spans customizados,
custom vista com spans detecta desvio, assinatura cobre o round-trip.

### V2. Densidade como segmented control nomeado

Hoje: botao so-icone que cicla normal, grande, compacta (ordem nao
monotonica), sem estado visivel, e em 1280px compacta e normal produzem o
mesmo layout. Substituir por segmented control de 3 estados visiveis e
nomeados (compacta, normal, grande), estado ativo evidente, operavel por
teclado como radiogroup ou grupo de botoes com aria-pressed.

Contrato tolerante com polish-motor: TorreGrid passara a fornecer a prop
opcional `aoDefinirDensidade?: (d: 0 | 1 | 2) => void` que define densidade
explicitamente. Consumir se presente; se ausente, fallback para o callback
de ciclo existente chamado as vezes necessarias (defensivo, temporario). Se
a interface atual de props for diferente do descrito, adaptar e registrar
nas decisoes da frente.

### V3. Reset e undo

Hoje nao existe forma de voltar ao layout padrao nem desfazer nenhuma das 6
mutacoes de layout (mover, redimensionar, colapsar, ocultar, aplicar vista,
excluir vista). Implementar:

- Acao "Restaurar layout padrao" visivel na barra de vistas.
- Toast efemero autocontido (sem tocar App.tsx): implementar dentro da
  arvore da Torre em TorreVistas ou componente irmao, com acao "Desfazer"
  para as mutacoes intermediadas pela barra (aplicar vista, excluir vista,
  restaurar padrao, salvar vista). Mutacoes por drag sao territorio do
  motor; se a arquitetura permitir expor undo para elas sem editar
  TorreGrid.tsx, documentar como integracao futura nas decisoes da frente.
- Anuncios do toast tambem na regiao aria-live existente.

### V4. Vista padrao global entre pedidos

Hoje layout e por pedido e vista custom e global mas nunca auto-aplicada:
abrir pedido novo sempre cai no default. Implementar opcao "usar em todos
os pedidos" nas vistas salvas (uma unica vista global por vez). Semantica:
quando nao existe layout especifico do pedido, aplica a vista global; layout
especifico do pedido sempre vence. Testes obrigatorios.

### V5. Vista salva completa

`salvarVista` hoje captura apenas ordem+spans. Incluir recolhidos e
densidade. Ao aplicar, restaurar tudo. Compatibilidade: vistas antigas
salvas sem esses campos continuam funcionando (campos opcionais). Testes.

### V6. Foco devolvido ao controle de origem (a11y)

Medido pelo auditor: salvar vista (submit ou Escape) e excluir vista jogam
o foco para BODY. Corrigir com refs: submit/Escape do form devolve foco ao
botao "Salvar vista atual"; excluir vista move foco para o chip vizinho ou
para o grupo. Teste manual descrito no relatorio.

### V7. Colisao Fiscal vezes dois

As abas de lente (Fiscal/Financeiro, filtro por parte em PainelPedido) e os
chips de vista (Fiscal/Financeiro, preset de layout) dividem barras
adjacentes com nomes identicos e significados ortogonais. Como PainelPedido
e territorio de outra frente, a solucao aqui e renomear ou rezonificar os
presets de vista: proposta recomendada, prefixar visualmente os chips como
"Visao" (ex.: chip com label "Fiscal" passa a ter um marcador de tipo
"layout" ou a secao ganha rotulo "Vistas de layout"), ou renomear presets
para nomes de tarefa (implementador decide e justifica). O objetivo e que
nenhum usuario confunda os dois sistemas. Registrar a decisao na frente.

### V8. Badge de cards ocultos

O menu Cards nao indica quantos cards estao ocultos. Adicionar contador
visivel (ex.: "Cards, 3 ocultos" ou badge numerico). Se o menu Cards for
renderizado por TorreGrid.tsx (verificar no codigo), implementar a parte de
layout.ts/TorreVistas que couber e registrar o restante como fiacao de
integracao nas decisoes da frente.

### V9. Limpeza de feedback visual

Acoes sem efeito visual auto-evidente (vista salva, vista excluida, vista
aplicada) precisam de confirmacao visual efemera (o toast de V3 cobre).
Manter os anuncios aria-live existentes funcionando.

## Criterios de aceite

1. Aplicar preset Operação, clicar na pill de largura de qualquer card,
   reaplicar: chip ativo aparece. Teste automatizado cobre o cenario.
2. Segmented control mostra o estado ativo sem hover, opera por teclado,
   e cada clique muda a densidade para o valor nomeado (nao cicla).
3. Restaurar layout padrao devolve ordem/spans/ocultos/recolhidos/densidade
   ao default; toast com Desfazer reverte.
4. Marcar vista custom como global; abrir pedido sem layout proprio carrega
   a vista global; pedido com layout proprio ignora.
5. Salvar vista com 2 cards colapsados e densidade compacta; aplicar em
   outro contexto restaura os dois estados.
6. Tabulando: salvar vista e excluir vista nunca jogam foco para body.
7. Nenhum par de controles adjacentes compartilha o mesmo nome com
   significados diferentes.
8. tsc limpo, vitest passando (incluir os testes novos), build ok.

## Decisoes da frente

1. **V1, lente por template.** `templateCorrespondente` compara ordem+ocultos
   sempre; os spans do proprio template sao a lente da comparacao de
   larguras. Presets nao declaram spans, entao ignoram os do usuario (volta a
   valer D-T5 da spec 0014). Vista custom que declara spans confere so os
   cards que ela controla; span em card nao declarado e ajuste livre e nao
   quebra a correspondencia. Recolhidos e densidade nao fazem parte da
   identidade da vista (sao estado restaurado na aplicacao, nao assinatura).
2. **`spans: {}` declarado limpa larguras.** `aplicarTemplate` passou a
   devolver os campos extras que o template declara (recolhidos, densidade,
   spans): o merge `{...prev, ...aplicado}` que o Grid ja fazia restaura tudo
   sem editar TorreGrid. `spans: {}` no template significa "voltar as
   larguras padrao", usado pelo template de reset e por snapshots de estado
   sem larguras proprias. Templates que nao declaram o campo continuam
   preservando o estado atual.
3. **Bug correlato corrigido: ocultos de vista custom.** `lerTemplatesCustom`
   usava `normalizarOrdem`, que anexa todos os cards a ordem lida; como a
   ordem do template e a lista de visiveis, a vista reaplicada apos reload
   nao ocultava nada. Trocado por `filtrarValidos`; teste cobre.
4. **Sidecar `forseti:torre:v2:vistas-meta`.** O salvar do TorreGrid atual
   cria a vista so com ordem+spans e nao ha como a barra completar o objeto
   sem editar o arquivo. Solucao: diff de `customizados` apos salvar grava
   recolhidos+densidade (lidos do layout persistido do pedido) e a marca
   global num sidecar por id; `mesclarMetaTemplate` enriquece o template no
   clique e `lerTemplatesCustom` mescla na leitura, entao aplicar restaura
   tudo hoje e o campo migra para o template quando o Grid o gravar. O
   sidecar vira redundante e removivel apos a integracao do item 7.
5. **V4 via `lerLayoutPedido`.** A auto-aplicacao da vista global acontece na
   leitura: pedido sem layout proprio recebe `templateParaLayout` da vista
   marcada; layout do pedido sempre vence. Como o Grid recarrega por
   `pedidoId`, abrir outro pedido ja herda a global. A marcacao e exclusiva
   (`definirVistaGlobal` grava `global:false` nas outras, vencendo ate flag
   antiga no template).
6. **Undo sem props novas quando possivel.** Desfazer de aplicar-vista e de
   restaurar-padrao usa `templateDeLayout(layoutPersistido)` reaplicado via
   `aoAplicar`. O layout e lido do storage pelo `pedidoId` (prop opcional;
   fallback: parse da rota `#/pedido/:id`, mesma leitura de useTorre). Toast
   com acao nao expira sozinho (regra a11y); informativo some em 4,5s.
   Desfazer de salvar-vista exclui a recem-criada via `aoExcluirCustom` com o
   id descoberto no diff da lista.
7. **Fiacao de integracao (TorreGrid, 4 linhas sugeridas).** Props opcionais
   ja consumidas com fallback:
   - `aoDefinirDensidade(d)`: contrato combinado com polish-motor; sem ela o
     segmented chama `aoAlternarDensidade` `(d - atual + 3) % 3` vezes.
   - `pedidoId={pedidoId}`: snapshots de undo sem depender do hash da URL.
   - `aoRestaurarVista(t)`: habilita Desfazer de excluir vista
     (`setTemplatesCustom(prev => [...prev, t])`); sem ela o toast de
     exclusao informa sem reversao.
   - `aoAnunciar={aoAnunciar}`: ecoa os textos do toast na regiao aria-live
     global; sem ela o proprio toast vira `role="status"`.
   - `aoSalvarCustom(nome, layout?)`: o segundo argumento (layout vigente)
     ja e enviado; quando o Grid o usar para montar a vista, o sidecar do
     item 4 pode morrer.
8. **V7 sem renomear presets.** Os nomes Operacao/Atrasos/Fiscal/Financeiro/
   Despacho sao conhecidos e documentados; a colisao e de contexto, nao de
   palavra. A zona ganha rotulo visivel "Layouts" (aria-labelledby do grupo)
   e os chips recebem nomes acessiveis unicos ("Aplicar layout Fiscal",
   "Aplicar vista X"), que nao colidem com a aba "Fiscal" das lentes nem
   visualmente nem na arvore de acessibilidade.
9. **Radiogroup no segmented (V2).** Preferido a grupo de botoes com
   aria-pressed: um unico tab stop com roving tabindex (alinhado a reducao
   de tab stops que polish-fluxo faz em PainelPedido) e setas que movem foco
   e selecao juntos, padrao APG radio.
10. **Estado visivel de "presets nao mexem".** Presets built-in nao declaram
    recolhidos/densidade de proposito: aplicar Operacao nao expande cards
    recolhidos nem muda a densidade: a vista so decide ordem e
    visibilidade. Recolhidos/densidade so viajam em vistas salvas, snapshots
    e no template de reset.
