# Intelipost: escopo público e o que aproveitar

Pesquisa de 26 e 27/11 sobre a Intelipost, o TMS de embarcador que
aparece primeiro quando o assunto é rastreio com várias transportadoras.
Responde a duas perguntas: o que ela cobre de fato, e o que disso entra
no Foundry, fica para depois ou fica fora. Complementa a posição já
registrada na spec 0010.

## Método e honestidade

- Só fontes públicas: páginas de produto, base de conhecimento, blog,
  SDK no GitHub e duas fontes de terceiros. Lista no fim.
- Não tivemos acesso ao painel, a uma demonstração nem a um cliente. O
  funcionamento interno descrito aqui é inferência da documentação.
- Os números são os que a empresa publica, sem conferência nossa, e nem
  sempre batem entre páginas. Transportadoras: "+1.400" em Quem Somos,
  Despacho e Reversa, "mais de 1.500" em Cotação. Clientes: "+ de 700"
  nas páginas de produto hoje, "mais de 4.000 empresas" no post de
  dezembro de 2020.
- Não lemos as páginas de Soluções por segmento nem a referência
  completa da API. Preço não é público.
- A seção "O que aproveitar" é leitura de trabalho de 27/11. É hipótese,
  sem validação com cliente ou mentor.

## A empresa

- Fundada em 2014 em São Paulo por Stefan Rehm e Gabriel Drummond.
- Aportes: Project-A em 2014 (R$ 850 mil e depois R$ 1,85 milhão),
  Performa Investimentos em 2016 e Riverwood Capital em 2020
  (R$ 130 milhões).
- Comprou a AgileProcess (roteirização e visibilidade em tempo real) e a
  Pegaki (pontos de retirada). As três formam o Grupo Intelipost.
- Publica "+120 integrações nativas" com plataformas de e-commerce,
  ERPs, WMS e hubs.
- Não transporta e não negocia frete. Centraliza os contratos que o
  cliente já tem com as transportadoras.
- Público declarado: e-commerce, varejo, marketplace, operador
  logístico, distribuidoras e entrega de maquininhas e cartões. A frase
  de capa é "comércio digital".

## Módulos

| Módulo | O que faz | Promessa publicada |
|---|---|---|
| Cotação | Guarda as tabelas de frete negociadas e calcula preço e prazo no checkout. Regras por região, faixa de CEP, centro de distribuição, canal de venda e tipo de cliente. Campanhas de frete grátis e cupons. | Até 30% de redução de custo |
| Despacho | Pré-lista de postagem, etiquetas em lote, romaneio por transportadora, declaração de conteúdo, envio por horário de corte e aviso de coleta. | Sem número |
| Entregas | Rastreio de todas as transportadoras da conta, regras de eventos, notificação por e-mail, SMS e WhatsApp, página de rastreio com a marca do cliente e pesquisa de satisfação. | Até 50% menos chamados de SAC |
| Reversa | Solicitação de troca e devolução, autorização de postagem, coleta por API ou EDI e status até o centro de distribuição. | Sem número |
| Auditoria de faturas | Lê CT-e padrão, globalizado e complementar e declaração de conteúdo, compara o cobrado com a tabela e com a cotação, aplica margem de divergência por regra, gera pré-fatura e permite negociar antes do pagamento. Cita integração com a Sefaz "sem depender da transportadora". | Até 5% da conta frete |
| Torre de Controle 360 | Quatro painéis: vendas, custos, performance e previsão de atraso. Mede OTD, SLA, ocorrências, tempo por etapa, latência de status e devoluções. Compara o lead time com um "índice Intelipost". | Sem número |
| Optimize | Simula cenários de frete combinando prazo, custo e SLA. | Sem número |

## Como o módulo de Entregas funciona

Inferência a partir da base de conhecimento.

**Entrada.** O status chega por três caminhos:

- API: o embarcador cria o pedido (`POST /shipment_order` na API V1) e a
  transportadora atualiza o status com a chamada `add-event`.
- EDI no padrão PROCEDA, em arquivos `.txt` trocados por sFTP. Cada
  transportadora recebe usuário e senha por cliente na implantação. O
  NOTFIS leva as notas ao transportador, o OCOREN devolve as
  ocorrências, o CONEMB traz os dados do CT-e, o DOCCOB é o documento de
  cobrança e o PREFAT é a pré-fatura.
- Manual: alteração no painel ou planilha com status em massa.

A transportadora empurra o dado porque foi integrada à conta do cliente.
Não achamos menção a consulta de página pública de rastreio.

**Status em dois níveis.** O que a transportadora manda é o micro
status. O sistema agrupa em macro status (em trânsito, entregue, falha
na entrega). O painel mantém a lista comparativa entre o nome recebido e
o nome que o cliente quer mostrar ao consumidor. Um status pode ter três
fontes: transportadora, Intelipost ou embarcador.

**Regras de eventos.** Cada status que entra passa por regras com
prioridade numérica ajustada à mão. Todas as condições de uma regra
precisam valer.

- Condições: método de envio, evento entrando (com escolha da fonte),
  status presente no histórico, evento anterior, região de destino,
  canal de vendas, número de repetições do mesmo status e diferenças de
  tempo (entre o horário do evento e o horário em que foi enviado, entre
  o evento e o anterior, entre o evento e uma data fixa).
- Ações: não alterar status, recalcular a previsão de entrega,
  substituir o status, ajustar data e hora, marcar a alteração nos logs
  e notificar por e-mail, webhook, SMS ou WhatsApp. SMS e WhatsApp são
  contratados à parte.

Dois exemplos da própria documentação mostram para que as regras servem:

- Trocar status que contêm a palavra "roubo" por um mais ameno, para
  reduzir o impacto no consumidor final.
- Corrigir o horário do "entregue" que algumas transportadoras mandam
  com hora anterior ao "saiu para entrega".

Parte grande do motor existe para limpar o fluxo que vem das
transportadoras: status duplicado, fora de ordem ou posterior ao
finalizador.

**Saída.** Webhook configurado por regra, para o sistema do cliente ou
para a transportadora (uma transportadora por regra). Há uma tela de
gestão dos disparos com histórico de 30 dias, separação por erro e
sucesso e reenvio manual. O reenvio aceita até 500 pedidos por vez, com
autenticação básica, NTLM ou nenhuma.

**Apoio.** Uma tela converte o arquivo OCOREN em planilha para o cliente
conferir o que a transportadora mandou.

## Diferença de modelo

A Intelipost serve um embarcador. Havendo mais de uma fonte para o mesmo
status, a regra do cliente escolhe qual vale, e pode substituir o status
ou a data antes de mostrar. O histórico é do embarcador e ele o edita.

O Foundry compara as fontes. NF-e, CT-e, planilha e a declaração da
transportadora ficam lado a lado, a diferença abre caso com dono e
prazo, e a cadeia de hashes impede reescrever o que foi declarado.

A sobreposição é real em quatro pontos: status com origem, exceção com
alerta, notificação por vários canais e webhook de saída. A spec 0010 já
fixa o limite: o Foundry não é rastreio com várias transportadoras e não
compete com a torre de controle. O espaço é a transportadora sem
integração e a prova neutra entre as partes.

## O que aproveitar

### Agora, antes de 30/11

Só texto e nomenclatura. Nada aqui pede código novo.

1. Nomear a diferença no vídeo e no pitch antes que a banca pergunte.
   Frase de trabalho: "A Intelipost dá ao embarcador visibilidade sobre
   a entrega. O Foundry trata do momento em que NF-e, CT-e, planilha e a
   palavra da transportadora discordam, e guarda prova do que cada parte
   declarou."
2. Chamar de "latência de status" o que o produto já mede. A pendência
   `sem_atualizacao` (`app/server/pendencia.ts`) é a medida que a Torre
   de Controle vende com esse nome. Vale o termo do mercado na tela de
   insights e no vídeo.
3. Adotar os nomes de ocorrência do OCOREN nos tipos de exceção em vez
   de criar vocabulário. O manual lista atraso, avaria, extravio,
   retenção em posto fiscal e entrega concluída.

### Depois da entrega

1. Leitor de OCOREN e CONEMB. São arquivos posicionais, então o parser é
   determinístico e fica dentro da regra do motor. Um leitor cobre a
   transportadora média e grande sem integrar uma a uma. A spec 0011
   deixou OCOREN e EDI como pesquisa. O conversor de OCOREN para
   planilha é uma porta de entrada barata para quem ainda confere o
   arquivo à mão.
2. Margem de divergência por regra. Hoje a tolerância de peso é uma
   constante (`TOLERANCIA_PESO_KG` em `app/shared/divergence.ts`). A
   auditoria da Intelipost deixa o cliente definir a margem por tipo de
   divergência com base no histórico. Reduz caso falso sem mexer no
   modelo.
3. Dois horários por evento: o do fato e o da chegada. Quatro das
   condições da Intelipost comparam esses horários, sinal de que
   transportadora manda evento atrasado e fora de ordem. A conferir:
   se o evento do Foundry já guarda os dois.
4. Regras de limpeza como sinal. Status repetido, status depois de
   "entregue" e "entregue" com hora anterior à saída viram alerta ou
   caso, com o evento original preservado.
5. Operação do webhook: histórico de disparos, reenvio manual e nova
   tentativa. A spec 0012 deixou retry, fila e assinatura HMAC fora. A
   assinatura HMAC é melhor que as opções que a Intelipost oferece.
6. Tradução de status entre transportadoras. Com modelo de linguagem ou
   de decisão o custo de traduzir caiu, mas cada tradução nova passa por
   revisão humana e fica guardada. A spec 0013 mantém o rastreio externo
   fora da matriz de divergência até existir essa tradução.
7. Pré-fatura como alavanca do financeiro. DOCCOB e PREFAT são os
   arquivos em que a cobrança da transportadora aparece antes do
   pagamento. É onde uma divergência aberta pode segurar um CT-e, se o
   contrato do cliente permitir.
8. Previsão de atraso por pedido. A Torre anuncia "pedidos com alta
   probabilidade de atraso" sem explicar o método. Só faz sentido no
   Foundry com volume real para medir acerto.

### Fora

1. Substituir status e ajustar data ou hora. Contradiz o registro
   append-only e a tese. Correção entra como evento novo com autor.
2. Comunicação com o consumidor final: página "onde está meu pedido",
   SMS, WhatsApp de marca e pesquisa de satisfação. É B2C.
3. Cotação, campanhas de frete e checkout. Outro produto.
4. Despacho: emitir etiqueta, pré-lista e romaneio. O romaneio interessa
   como identificador que o despachante reconhece, para ler e citar.
5. Reversa.
6. Simulação de frete e roteirização (D-002).
7. Motor de regras configurável pelo cliente, com condições combinadas e
   prioridade manual. O setor não é letrado digitalmente (aprendizado da
   TOTVS). O Foundry fica com regras fixas e poucos limiares.
8. Integração contratual transportadora por transportadora, com
   credencial de sFTP por cliente. É a força e o custo da Intelipost. A
   tese do Foundry é ler o que cada parte já produz.
9. Auditoria de frete (tabela contra cobrado). A Intelipost cobre, como
   o adendo da spec 0018 já registra.
10. Painéis de vendas, GMV e conversão.

## Nota lateral: modelo de decisão para classificar respostas

Ligada aos itens 4 e 6 de "Depois da entrega". Um modelo de decisão
responde a uma pergunta tipada e devolve probabilidades entre opções
fixas, sem gerar texto. O Jev, da TypeSafe AI, é o exemplo que olhamos.

- Onde encaixaria: classificar a resposta da transportadora (status
  declarado, promessa de verificar, recusa, fora de assunto) e servir de
  portão antes de aceitar um claim. Hoje a confiança é um número que o
  próprio modelo de linguagem declara, com tetos determinísticos por
  cima.
- O que não faz: extrair campo do texto. A data continua vindo da
  extração.
- Ressalvas das avaliações independentes, que não reproduzimos: as
  probabilidades binárias ordenam bem mas ficam mal posicionadas em
  relação ao limiar de 0,5, o desempenho cai em rótulos finos e em
  línguas com menos recurso, e um dos estudos não achou vantagem de
  custo sobre um modelo de linguagem em preço de lote. Não achamos teste
  em português de logística.
- Regra que não muda: saída de modelo assiste, o motor determinístico
  decide e ancora (spec 0007).

## Perguntas abertas

- Quanto custa e como cobra (por pedido, por módulo, por transportadora).
- Das transportadoras integradas, quantas falam API e quantas só EDI, e
  com que frequência o OCOREN chega.
- Se a "probabilidade de atraso" da Torre é modelo estatístico ou regra.
- Quanto da base é B2B industrial. A comunicação é de comércio digital,
  mas há páginas para distribuidoras e operadores logísticos.
- O estudo de caso da X8 cita desenvolvimento de blockchain com prêmios
  de Oracle e IBM. É fonte secundária e não achamos confirmação no site
  da Intelipost.

## Fontes

Consultadas em 26 e 27/11/2026.

Produto e empresa:

- [Entregas](https://www.intelipost.com.br/produtos/entregas/)
- [Cotação](https://www.intelipost.com.br/produtos/cotacao/)
- [Despacho](https://www.intelipost.com.br/produtos/despacho/)
- [Reversa](https://www.intelipost.com.br/produtos/reversa/)
- [Auditoria de faturas](https://www.intelipost.com.br/produtos/auditoria-de-faturas/)
- [Torre de Controle 360](https://www.intelipost.com.br/produtos/torre-de-controle/)
- [Optimize](https://www.intelipost.com.br/produtos/intelipost-optimize/)
- [Quem Somos](https://www.intelipost.com.br/quem-somos/)
- [Grupo Intelipost, post de 25/07/2023](https://www.intelipost.com.br/blog/grupo-intelipost-marco-historia/)
- [Investimento e fusão com a AgileProcess, post de 08/12/2020](https://www.intelipost.com.br/blog/intelipost-anuncia-investimento-e-fusao-com-agileprocess/)
- [O padrão PROCEDA](https://www.intelipost.com.br/blog/arquivos-de-edi-padrao-proceda/)

Base de conhecimento:

- [Tudo sobre o módulo Entregas](https://ajuda.intelipost.com.br/pt-BR/articles/5527499-painel-da-intelipost-tms-tudo-sobre-o-modulo-entregas)
- [Regras de eventos](https://ajuda.intelipost.com.br/pt-BR/articles/5527413-painel-da-intelipost-tms-regras-de-eventos)
- [Sobre a Intelipost](https://ajuda.intelipost.com.br/pt-BR/articles/5527501-sobre-a-intelipost)
- [Notificações via webhook](https://ajuda.intelipost.com.br/pt-BR/articles/5527430-como-configurar-o-envio-de-notificacoes-via-webhook)
- [Gestão de disparos de webhook](https://ajuda.intelipost.com.br/pt-BR/articles/12241246-como-realizar-a-gestao-de-disparos-e-configuracoes-de-seus-webhooks)
- [Como a transportadora disponibiliza os arquivos PROCEDA](https://ajuda.intelipost.com.br/pt-BR/articles/5527436-como-a-transportadora-pode-disponibilizar-os-arquivos-proceda-edi)
- [Glossário](https://ajuda.intelipost.com.br/pt-BR/articles/5527507-glossario-termos-mais-utilizados-na-intelipost)
- [Manual OCOREN 5.0](https://ajuda.intelipost.com.br/pt-BR/articles/5527505-manual-ocoren-5-0)
- [Documentação técnica da API](https://ajuda.intelipost.com.br/pt-BR/articles/5527503-documentacao-tecnica-para-integracao-via-api)
- [SDK Java](https://github.com/intelipost/sdk-java)

Terceiros:

- [Estudo de caso da X8 Investimentos](https://x8invest.ventures/intelipost-2/)
- [PEGN, 18/12/2014: aporte de R$ 1,85 milhão](https://revistapegn.globo.com/Banco-de-ideias/Mundo-digital/noticia/2014/12/intelipost-levanta-r-185-milhao-para-ajudar-lojas-online-com-suas-entregas.html)

Modelo de decisão:

- [Evaluating and Benchmarking the System One Model Jev](https://arxiv.org/abs/2609.37647v1)
- [JEV versus LLMs: seven political science replications](https://arxiv.org/html/2610.06625)
- [Compilação independente de comparativos](https://jevmodel.ai/decision-models/)
