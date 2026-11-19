# Escopo — documento de trabalho

Síntese do que já foi decidido e do que ainda está aberto, compilada da call de
alinhamento (16/11), do resumo e da conversa no Discord. Não é um documento
final: serve para o time discutir em cima do mesmo mapa.

## O que já está decidido

- **Direção:** camada de coordenação entre fornecedores, operadores logísticos
  e áreas financeira/fiscal. Escolhida na call (~41min) por ser mais escalável
  que a alternativa e por a dor já ter sido validada em campo.
- **Roteirização interna: fora do escopo.** O mercado já está cheio de soluções
  (avaliação da especialista em armazéns), exige algoritmos determinísticos
  (OR-Tools — LLM não serve para decisão que pode estragar carga) e, para PMEs,
  depende de hardware. Digital Twin fica como referência, não como produto.
- **Blockchain: alternativa, não requisito.** Faz sentido se a camada precisar
  de registro compartilhado/confiável entre empresas que não se conhecem; se
  APIs + trilha de auditoria bastarem, melhor.
- **Simplicidade de adoção é requisito, não nice-to-have.** O setor não é
  letrado digitalmente: solução que exige mudança de rotina morre na gaveta
  (aprendizado direto da TOTVS). Integração precisa ser trivial — API aberta,
  documentação à prova de leigo.
- **Sem promessa de implantação real antes de 30/11.** Avaliação honesta do
  time na call.

## A pergunta que define o MVP

Dentro da gestão multi-fornecedor, qual sub-dor vem primeiro? Cada resposta
vira um produto diferente:

| Candidato | O que é | Onde apareceu |
|---|---|---|
| **Atraso propagado** | Um parceiro atrasa → alertar e coordenar os demais (e o financeiro) antes do efeito dominó | Exemplo central do contato TOTVS |
| **Documentos fiscais / NF** | Registro e documentação da carga ponta a ponta (o que a Emiteaí ataca em parte) | Call + site da Emiteaí |
| **Recebimento / etiquetas** | Padronizar códigos e conferência na entrada do galpão (kits, lotes, peso variável) | Especialista em armazéns |
| **Contratos / conciliação** | Revalidar contratos e pagamentos quando a operação muda | Call (cascata para os bancos) |

Pergunta pendente para o contato da TOTVS e para a call da Enviagora.

## Leitura candidata de escopo (em discussão)

> Uma camada sobre os sistemas que já existem, que cria uma verdade
> compartilhada entre fornecedores, operadores e financeiro — flagrando
> desvios antes que propaguem — e já carrega a capacidade ociosa como dado,
> pra orquestrá-la quando a rede estiver falando a mesma língua.

Ou seja: MVP = coordenação; capacidade/oferta entra como **tipo de dado** na
camada (doca livre, espaço de retorno, posição de estoque), não como
marketplace. O "Physical Capacity Orchestrator" do dossiê fica como visão de
arco — orquestrar capacidade é a consequência de a rede já enxergar.

## Riscos já mapeados (dossiê)

1. **Cold start multi-lado** — resolver fábrica + caminhão + galpão ao mesmo
   tempo dilui foco; começar hiper-focado.
2. **ERPs legados / fricção de dados** — ingestão multimodal (XML de NF-e, PDF,
   planilha) e onboarding leve no dia 1.
3. **Seguro e responsabilidade** — custódia e averbação por trecho se a carga
   atravessar operadores.
4. **Efeito bypass** — partes fecharem direto por fora; resposta: emissão
   fiscal e contrato embutidos no fluxo.
5. **Custos invisíveis** — desvio de rota, fila de doca, mão de obra extra.

## Próximos passos de escopo

- [ ] Call com Rafael Born (Enviagora) — remarcada, sem nova data. Objetivo:
      um caso real bem entendido + qual dor investigar primeiro.
- [ ] Pergunta ao contato TOTVS: dentro da gestão de fornecedores, o que dói
      mais — documento fiscal, atraso propagado ou contrato/pagamento?
- [ ] Visita ao galpão (convite da Vivianne/Isabela, GCCA · CAP Logística).
- [ ] Diferenciação vs. Emiteaí (o que cobre de fato além de emissão fiscal?).
