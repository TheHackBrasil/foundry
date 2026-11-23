# Brief · frente `ai-web` (RESERVADA)

Status: reservada pelo usuário. Nenhuma implementação nesta spec.

O que existe aqui é só o contrato que a `ai-mandatos` entrega no
servidor: `ViewSpec` (`app/shared/model.ts`) e o endpoint
`GET /api/pedidos/:id/view-spec?papel=<parte>`, que devolve a visão
gerada pela LLM e validada server-side, ou a visão padrão
determinística quando a LLM falha ou não está configurada.

Contrato (RF9 da spec):

```ts
interface ViewSpec {
  versao: 1;
  fontesVisiveis: FonteDocumento[];  // quais fontes a matriz mostra
  colunas: CampoVigiado[];           // quais campos vigiados viram coluna
  lente: Parte;                      // visão de qual papel
  destacarDivergencias: boolean;     // divergências em evidência
}
```

Regra da renderização quando ela existir: o front consome o spec e
monta a tela só com os componentes já existentes em `app/web/src/`
(matriz de fontes, lista de pedidos, tarefas por parte, status da
cadeia). Nenhum componente é inventado a partir do spec; campo fora do
schema é descartado pelo servidor antes de chegar. A11y da spec 0006 e
as regras de marca da v4 seguem valendo inteiras.

Paths: nenhum de código nesta spec; a entrada em `frentes.json` existe
só para registrar a reserva do nome e o dono do trabalho futuro.
Quando o usuário for implementar, a frente ganha brief próprio com
paths reais de `app/web/`.

Base: `main` com as specs 0008 e 0007 integradas.

Proibido: escrever em `app/web/` ou em qualquer path dentro desta spec;
a implementação pertence ao trabalho futuro do usuário com outro
agente.

## Decisões da frente

(preencher quando a frente for ativada de verdade)
